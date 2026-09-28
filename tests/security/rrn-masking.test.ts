/**
 * Security tests — RRN (주민등록번호) masking, KR compliance phase 2 (PIPA).
 * Fixture CSV chứa RRN synthetic (checksum-valid) → khẳng định raw RRN không
 * xuất hiện trong: transform/export output, deidentified bundle, audit line,
 * và đường import CSV/Excel chuẩn (core importer + API response).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import type { ColumnMapping, Bundle, AuditLogEntry } from '@fhirbridge/types';
import {
  mapRow,
  transformToFhir,
  deidentify,
  hashIdentifier,
  containsRrn,
  importTabularFile,
  parseMappingConfig,
} from '@fhirbridge/core';
import { AuditService, type AuditSink } from '../../packages/api/src/services/audit-service.js';
import { bearerHeader, createTestServer, userJwt } from '../integration/helpers.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/csv/kr-sample-patients.csv', import.meta.url),
);

// RRN synthetic trong fixture (checksum hợp lệ — xem rrn-detector.test.ts)
const FIXTURE_RRNS = ['800101-1234560', '900202-2345679', '800101-5234561'];
const HMAC_SECRET = 'test-hmac-secret-for-rrn-masking-tests';

const MAPPINGS: ColumnMapping[] = [
  { sourceColumn: '환자ID', fhirPath: 'id', resourceType: 'Patient', transform: 'string' },
  {
    sourceColumn: '주민등록번호',
    fhirPath: 'identifier[0].value',
    resourceType: 'Patient',
    transform: 'string',
  },
  { sourceColumn: '성명', fhirPath: 'name[0].text', resourceType: 'Patient', transform: 'string' },
  { sourceColumn: '생년월일', fhirPath: 'birthDate', resourceType: 'Patient', transform: 'date' },
  { sourceColumn: '성별', fhirPath: 'gender', resourceType: 'Patient', transform: 'string' },
  {
    sourceColumn: '진단명',
    fhirPath: 'code.text',
    resourceType: 'Condition',
    transform: 'string',
  },
];

/** Parse fixture CSV thành rows (fixture đơn giản, không quoted comma). */
function loadFixtureRows(): Record<string, string>[] {
  const lines = readFileSync(FIXTURE_PATH, 'utf8').trim().split(/\r?\n/);
  const headers = lines[0]!.split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  });
}

/** Transform toàn bộ fixture qua mapRow + transformToFhir, trả JSON output. */
function transformFixture(rrnSecret?: string): string {
  const resources: unknown[] = [];
  for (const [rowIndex, row] of loadFixtureRows().entries()) {
    for (const record of mapRow(row, MAPPINGS, 'kr-fixture', rowIndex)) {
      resources.push(
        transformToFhir(record.data, record.resourceType, undefined, 'DMY', rrnSecret),
      );
    }
  }
  return JSON.stringify(resources);
}

describe('RRN masking — ingest/export path', () => {
  it('fixture thật sự chứa RRN hợp lệ (guard chống fixture mục nát)', () => {
    expect(containsRrn(readFileSync(FIXTURE_PATH, 'utf8'))).toBe(true);
  });

  it('transform với HMAC secret: output không chứa raw RRN (identifier được hash)', () => {
    const output = transformFixture(HMAC_SECRET);
    for (const rrn of FIXTURE_RRNS) {
      expect(output).not.toContain(rrn);
      expect(output).not.toContain(rrn.replace('-', ''));
    }
    expect(containsRrn(output)).toBe(false);
  });

  it('transform không có secret: RRN bị mask, output vẫn sạch', () => {
    const output = transformFixture(undefined);
    for (const rrn of FIXTURE_RRNS) {
      expect(output).not.toContain(rrn);
    }
    expect(output).toContain('######-*******');
    expect(containsRrn(output)).toBe(false);
  });
});

describe('RRN masking — AI summary path (deidentify)', () => {
  it('bundle chứa RRN sót trong free-text → deidentified output sạch RRN', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'kr-1',
            identifier: [{ system: 'urn:kr:rrn', value: FIXTURE_RRNS[0]! }],
            multipleBirthString: `등록번호 ${FIXTURE_RRNS[1]!} 참조`,
          } as never,
        },
      ],
    };

    const { bundle: deidentified } = deidentify(bundle, HMAC_SECRET);
    const output = JSON.stringify(deidentified);

    for (const rrn of FIXTURE_RRNS) {
      expect(output).not.toContain(rrn);
    }
    expect(containsRrn(output)).toBe(false);
  });
});

describe('RRN masking — audit path', () => {
  it('audit line cho export flow không bao giờ chứa RRN (chỉ hash + counts)', async () => {
    const captured: AuditLogEntry[] = [];
    const sink: AuditSink = {
      write: async (entry) => {
        captured.push(entry);
      },
    };

    // Worst case: user id nguồn là RRN — audit chỉ nhận bản hash theo contract
    const audit = new AuditService(sink);
    await audit.log({
      userIdHash: hashIdentifier(FIXTURE_RRNS[0]!, HMAC_SECRET),
      action: '/api/v1/export',
      status: 'success',
      resourceCount: 3,
      metadata: { connector: 'csv', market: 'KR' },
    });

    const line = JSON.stringify(captured);
    for (const rrn of FIXTURE_RRNS) {
      expect(line).not.toContain(rrn);
    }
    expect(containsRrn(line)).toBe(false);
  });
});

// ── Canonical CSV/Excel import (parseMappingConfig + importTabularFile + API) ──

const KR_EXAMPLE_DATA = fileURLToPath(
  new URL('../../examples/data/kr-hospital.csv', import.meta.url),
);
const KR_EXAMPLE_MAPPING = fileURLToPath(
  new URL('../../examples/column-mappings/csv-korea-hospital.json', import.meta.url),
);
const KR_EXAMPLE_RRNS = ['800101-1234560', '900202-2345679', '750505-1345673'];

/** Canonical mapping for the legacy KR fixture (성명 = full name, used as family). */
const FIXTURE_CANONICAL_MAPPING = {
  patientId: { column: '환자ID', system: 'urn:example:kr-mrn' },
  fields: {
    'Patient.identifier[].value': '주민등록번호',
    'Patient.name.family': '성명',
    'Patient.birthDate': '생년월일',
    'Patient.gender': '성별',
    'Condition.code.coding[].code': '진단코드',
    'Condition.code.text': '진단명',
  },
};

function expectNoRrn(output: string, rrns: string[]) {
  for (const rrn of rrns) {
    expect(output).not.toContain(rrn);
    expect(output).not.toContain(rrn.replace('-', ''));
  }
  expect(containsRrn(output)).toBe(false);
}

describe('RRN masking — canonical import path', () => {
  it('example sample data really contains checksum-valid RRNs', () => {
    expect(containsRrn(readFileSync(KR_EXAMPLE_DATA, 'utf8'))).toBe(true);
  });

  it('KR example: hashed with secret, masked without — never raw', async () => {
    const mapping = parseMappingConfig(readFileSync(KR_EXAMPLE_MAPPING, 'utf8'));
    const hashed = await importTabularFile({
      filePath: KR_EXAMPLE_DATA,
      mapping,
      rrnSecret: HMAC_SECRET,
    });
    expectNoRrn(JSON.stringify(hashed.bundle), KR_EXAMPLE_RRNS);
    expect(JSON.stringify(hashed.bundle)).not.toContain('######-*******');
    expect(hashed.resourceCount).toBeGreaterThan(0);

    const masked = await importTabularFile({ filePath: KR_EXAMPLE_DATA, mapping });
    expectNoRrn(JSON.stringify(masked.bundle), KR_EXAMPLE_RRNS);
    expect(JSON.stringify(masked.bundle)).toContain('######-*******');
  });

  it('legacy KR fixture through a canonical mapping: bundle and issues are RRN-free', async () => {
    const mapping = parseMappingConfig(FIXTURE_CANONICAL_MAPPING);
    for (const rrnSecret of [HMAC_SECRET, undefined]) {
      const result = await importTabularFile({ filePath: FIXTURE_PATH, mapping, rrnSecret });
      expect(result.stats.resourcesByType).toEqual({ Patient: 3, Condition: 3 });
      expectNoRrn(JSON.stringify(result.bundle), FIXTURE_RRNS);
      expectNoRrn(JSON.stringify(result.issues), FIXTURE_RRNS);
    }
  });

  it('RRN used as patientId and in free text is protected too', async () => {
    const mapping = parseMappingConfig({
      patientId: '주민등록번호',
      fields: { 'Patient.name.family': '성명', 'Condition.code.text': '주민등록번호' },
    });
    const result = await importTabularFile({
      filePath: FIXTURE_PATH,
      mapping,
      rrnSecret: HMAC_SECRET,
    });
    expect(result.resourceCount).toBe(6);
    expectNoRrn(JSON.stringify(result.bundle), FIXTURE_RRNS);
  });

  it('API import response never contains a raw RRN', async () => {
    const server = await createTestServer();
    try {
      const boundary = 'rrn-boundary';
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="kr.csv"\r\nContent-Type: text/csv\r\n\r\n`,
        ),
        readFileSync(KR_EXAMPLE_DATA),
        Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="mapping"\r\n\r\n`),
        readFileSync(KR_EXAMPLE_MAPPING),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/connectors/import',
        headers: {
          authorization: bearerHeader(userJwt()),
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expectNoRrn(res.body, KR_EXAMPLE_RRNS);
    } finally {
      await server.close();
    }
  });
});
