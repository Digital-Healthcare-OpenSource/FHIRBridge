/**
 * Security tests — RRN (주민등록번호) masking, KR compliance phase 2 (PIPA).
 * Fixture CSV chứa RRN synthetic (checksum-valid) → khẳng định raw RRN không
 * xuất hiện trong: transform/export output, deidentified bundle, audit line.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import type { ColumnMapping, Bundle, AuditLogEntry } from '@fhirbridge/types';
import { mapRow, transformToFhir, deidentify, hashIdentifier, containsRrn } from '@fhirbridge/core';
import { AuditService, type AuditSink } from '../../packages/api/src/services/audit-service.js';

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
