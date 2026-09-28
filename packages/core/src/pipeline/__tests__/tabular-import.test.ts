/**
 * Tests for importTabularFile — every example mapping against its sample data
 * (examples/data), plus file-level guards (magic bytes, headers, limits).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import type { Bundle } from '@fhirbridge/types';

import { ConnectorError } from '../../connectors/his-connector-interface.js';
import { parseMappingConfig } from '../../connectors/mapping/mapping-config-parser.js';
import { containsRrn } from '../../security/rrn-detector.js';
import { validateCodeableConcept } from '../../validators/coding-validator.js';
import { validatePatient } from '../../validators/patient-validator.js';
import { validateReferenceInBundle } from '../../validators/reference-validator.js';
import { patterns, validateResource } from '../../validators/resource-validator.js';
import { TabularImportError, detectTabularFileType, importTabularFile } from '../tabular-import.js';

const REPO_ROOT = path.resolve(__dirname, '../../../../../');
const MAPPINGS = path.join(REPO_ROOT, 'examples/column-mappings');
const DATA = path.join(REPO_ROOT, 'examples/data');

const loadMapping = (file: string) =>
  parseMappingConfig(JSON.parse(fs.readFileSync(path.join(MAPPINGS, file), 'utf8')));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const EXAMPLES = [
  {
    mapping: 'csv-generic-hl7.json',
    data: 'generic-hl7.csv',
    counts: { Patient: 3, Encounter: 4, Condition: 4, Observation: 3 },
  },
  {
    mapping: 'csv-korea-hospital.json',
    data: 'kr-hospital.csv',
    counts: { Patient: 3, Encounter: 4, Condition: 4, Observation: 3 },
  },
  {
    mapping: 'csv-vneid-vn.json',
    data: 'vn-hospital.csv',
    counts: { Patient: 3, Encounter: 4, Condition: 4, Observation: 3 },
  },
  {
    mapping: 'excel-japan-clinic.json',
    data: 'jp-clinic.xlsx',
    counts: { Patient: 3, Encounter: 4, Condition: 4 },
  },
];

/** Assert every resource passes the repo validators and references resolve. */
function expectValidBundle(bundle: Bundle) {
  for (const entry of bundle.entry ?? []) {
    const r = entry.resource as unknown as Json;
    const result = r['resourceType'] === 'Patient' ? validatePatient(r) : validateResource(r);
    expect(result.errors.filter((e) => e.severity === 'error')).toEqual([]);
    if (r['resourceType'] === 'Patient') {
      expect(patterns.DATE.test(r['birthDate'])).toBe(true);
    }
    for (const key of ['code', 'clinicalStatus', 'category']) {
      const concepts = Array.isArray(r[key]) ? r[key] : r[key] ? [r[key]] : [];
      for (const cc of concepts) {
        // no errors AND no "not a recognized terminology URI" warnings (ICD-10 is known)
        expect(validateCodeableConcept(cc, key).errors).toEqual([]);
      }
    }
    for (const key of ['subject', 'encounter']) {
      if (r[key]) expect(validateReferenceInBundle(r[key], bundle, key).errors).toEqual([]);
    }
    for (const key of ['effectiveDateTime']) {
      if (r[key]) expect(patterns.DATETIME.test(r[key])).toBe(true);
    }
    if (r['period']?.start) expect(patterns.DATETIME.test(r['period'].start)).toBe(true);
  }
}

describe('importTabularFile — example mappings with their sample data', () => {
  it.each(EXAMPLES)('$mapping + $data → non-empty, valid bundle', async (ex) => {
    const result = await importTabularFile({
      filePath: path.join(DATA, ex.data),
      mapping: loadMapping(ex.mapping),
    });
    expect(result.issues).toEqual([]);
    expect(result.stats.resourcesByType).toEqual(ex.counts);
    expect(result.resourceCount).toBe(Object.values(ex.counts).reduce((a, b) => a + b, 0));
    expect(result.bundle.entry).toHaveLength(result.resourceCount);
    expectValidBundle(result.bundle);
  });

  it('is deterministic: same file → same ids', async () => {
    const opts = {
      filePath: path.join(DATA, 'vn-hospital.csv'),
      mapping: loadMapping('csv-vneid-vn.json'),
    };
    const a = await importTabularFile(opts);
    const b = await importTabularFile(opts);
    expect(a.bundle.entry!.map((e) => e.fullUrl)).toEqual(b.bundle.entry!.map((e) => e.fullUrl));
  });

  it('VN: datetimes carry +07:00 and dd/mm/yyyy birth dates are normalized', async () => {
    const { bundle } = await importTabularFile({
      filePath: path.join(DATA, 'vn-hospital.csv'),
      mapping: loadMapping('csv-vneid-vn.json'),
    });
    const resources = bundle.entry!.map((e) => e.resource as unknown as Json);
    const patient = resources.find((r) => r['resourceType'] === 'Patient')!;
    expect(patient['birthDate']).toBe('1985-03-15');
    expect(patient['name']).toEqual([{ family: 'Nguyễn', given: ['Văn A'] }]);
    expect(patient['identifier']).toEqual([
      { system: 'http://fhir.ehealth.gov.vn/core/sid/national_id', value: '000000000101' },
    ]);
    const enc = resources.find((r) => r['resourceType'] === 'Encounter')!;
    expect(enc['period'].start).toBe('2024-03-04T08:30:00+07:00');
  });

  it('JP: multi-sheet workbook — Excel date cells, patients linked across sheets', async () => {
    const { bundle } = await importTabularFile({
      filePath: path.join(DATA, 'jp-clinic.xlsx'),
      mapping: loadMapping('excel-japan-clinic.json'),
    });
    const resources = bundle.entry!.map((e) => e.resource as unknown as Json);
    const patients = resources.filter((r) => r['resourceType'] === 'Patient');
    expect(patients.map((p) => p['birthDate'])).toEqual(['1980-04-01', '1992-08-15', '1975-12-31']);
    expect(patients.map((p) => p['gender'])).toEqual(['male', 'female', 'unknown']);
    const encounters = resources.filter((r) => r['resourceType'] === 'Encounter');
    expect(encounters[0]!['period'].start).toBe('2024-03-04T09:30:00+09:00');
    expect(encounters.map((e) => e['class'].code)).toEqual(['AMB', 'AMB', 'IMP', 'AMB']);
    const patientUrls = new Set(
      bundle.entry!.filter((e) => e.resource?.resourceType === 'Patient').map((e) => e.fullUrl),
    );
    for (const e of encounters) expect(patientUrls.has(e['subject'].reference)).toBe(true);
  });

  it('generic: value offsets are kept (EST/EDT/UTC) and empty phone → no telecom', async () => {
    const { bundle } = await importTabularFile({
      filePath: path.join(DATA, 'generic-hl7.csv'),
      mapping: loadMapping('csv-generic-hl7.json'),
    });
    const resources = bundle.entry!.map((e) => e.resource as unknown as Json);
    expect(
      resources.filter((r) => r['resourceType'] === 'Encounter').map((r) => r['period'].start),
    ).toEqual([
      '2024-03-04T09:30:00-05:00',
      '2024-04-02T10:15:00-04:00',
      '2024-03-11T14:00:00-04:00',
      '2024-03-20T08:45:00Z',
    ]);
    const patients = resources.filter((r) => r['resourceType'] === 'Patient');
    expect(patients.map((p) => p['telecom'] ?? null)).toEqual([
      [{ system: 'phone', value: '555-0101' }],
      null,
      [{ system: 'phone', value: '555-0103' }],
    ]);
  });
});

describe('importTabularFile — Korean RRN never reaches the output', () => {
  const opts = () => ({
    filePath: path.join(DATA, 'kr-hospital.csv'),
    mapping: loadMapping('csv-korea-hospital.json'),
  });

  it('the sample file really contains checksum-valid RRNs', () => {
    expect(containsRrn(fs.readFileSync(path.join(DATA, 'kr-hospital.csv'), 'utf8'))).toBe(true);
  });

  it('masks RRNs without a secret', async () => {
    const result = await importTabularFile(opts());
    const json = JSON.stringify(result.bundle);
    expect(containsRrn(json)).toBe(false);
    expect(json).toContain('######-*******');
    expect(result.stats.rrnValuesProtected).toBe(3);
  });

  it('HMAC-hashes RRNs with a secret', async () => {
    const result = await importTabularFile({
      ...opts(),
      rrnSecret: 'test-hmac-secret-0123456789abcdef',
    });
    const json = JSON.stringify(result.bundle);
    expect(containsRrn(json)).toBe(false);
    expect(json).not.toContain('######-*******');
    const patient = result.bundle.entry![0]!.resource as unknown as Json;
    expect(patient['identifier'][1].value).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('importTabularFile — file checks and errors', () => {
  let dir: string;
  const write = (name: string, content: string | Buffer) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhirbridge-tabular-'));
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('detects file type from the extension', () => {
    expect(detectTabularFileType('a.XLSX')).toBe('excel');
    expect(detectTabularFileType('a.csv')).toBe('csv');
    expect(detectTabularFileType('noext')).toBe('csv');
  });

  it('rejects a CSV whose header matches none of the mapped columns (lists both sides)', async () => {
    const file = write('other.csv', 'foo,bar\n1,2\n');
    const mapping = parseMappingConfig({ fields: { 'Patient.name.family': 'LAST' } });
    const err = await importTabularFile({ filePath: file, mapping }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TabularImportError);
    expect((err as TabularImportError).code).toBe('NO_MATCHING_COLUMNS');
    expect((err as Error).message).toBe(
      'None of the mapped columns were found in the header row of the CSV. Mapping expects: "LAST". File columns: "foo", "bar". Check that the mapping matches this file (examples: examples/column-mappings/).',
    );
  });

  it('rejects a missing patientId column', async () => {
    const file = write('nopid.csv', 'LAST\nDoe\n');
    const mapping = parseMappingConfig({
      patientId: 'MRN',
      fields: { 'Patient.name.family': 'LAST' },
    });
    await expect(importTabularFile({ filePath: file, mapping })).rejects.toThrow(
      /patientId column "MRN" was not found in the header row of the CSV/,
    );
  });

  it('warns per missing column when some columns match', async () => {
    const file = write('partial.csv', 'LAST\nDoe\n');
    const mapping = parseMappingConfig({
      fields: { 'Patient.name.family': 'LAST', 'Patient.gender': 'SEX' },
    });
    const result = await importTabularFile({ filePath: file, mapping });
    expect(result.resourceCount).toBe(1);
    expect(result.issues).toEqual([
      {
        severity: 'warning',
        column: 'SEX',
        message: 'column not found in the header row — Patient.gender will be empty',
      },
    ]);
  });

  it('rejects binary content disguised as CSV and non-zip content as .xlsx', async () => {
    const mapping = parseMappingConfig({ fields: { 'Patient.name.family': 'LAST' } });
    const bin = write('bin.csv', Buffer.from([0x4c, 0x41, 0x00, 0x01, 0x02]));
    await expect(importTabularFile({ filePath: bin, mapping })).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE',
    });
    const fake = write('fake.xlsx', 'LAST\nDoe\n');
    await expect(importTabularFile({ filePath: fake, mapping })).rejects.toThrow(
      'File content is not an .xlsx workbook',
    );
    const ole = write('old.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    await expect(importTabularFile({ filePath: ole, mapping })).rejects.toThrow(/Legacy \.xls/);
  });

  it('maps CSV parse errors to a message without cell contents', async () => {
    const file = write('broken.csv', 'LAST,FIRST\nDoe,"unterminated secret-value\n');
    const mapping = parseMappingConfig({ fields: { 'Patient.name.family': 'LAST' } });
    const err = (await importTabularFile({ filePath: file, mapping }).catch(
      (e: unknown) => e,
    )) as Error;
    expect(err).toBeInstanceOf(TabularImportError);
    expect(err.message).toMatch(/^CSV could not be parsed \(CSV_/);
    expect(err.message).not.toContain('secret-value');
  });

  it('enforces maxResources', async () => {
    await expect(
      importTabularFile({
        filePath: path.join(DATA, 'vn-hospital.csv'),
        mapping: loadMapping('csv-vneid-vn.json'),
        maxResources: 5,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  });

  it('Excel sheet override reads every type from that sheet; unknown sheet → clear error', async () => {
    const patientsOnly = parseMappingConfig({
      patientId: '患者番号',
      fields: { 'Patient.name.family': '姓', 'Patient.name.given': '名' },
    });
    const result = await importTabularFile({
      filePath: path.join(DATA, 'jp-clinic.xlsx'),
      mapping: patientsOnly,
      sheet: '患者',
    });
    expect(result.stats.resourcesByType).toEqual({ Patient: 3 });

    const err = await importTabularFile({
      filePath: path.join(DATA, 'jp-clinic.xlsx'),
      mapping: patientsOnly,
      sheet: 'Sheet9',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect((err as Error).message).toBe(
      'Sheet not found: "Sheet9" (workbook sheets: "患者", "受診")',
    );
  });

  it('Excel without a sheet setting reads the first sheet', async () => {
    const mapping = parseMappingConfig({
      patientId: '患者番号',
      fields: { 'Patient.name.family': '姓' },
    });
    const result = await importTabularFile({
      filePath: path.join(DATA, 'jp-clinic.xlsx'),
      mapping,
    });
    expect(result.resourceCount).toBe(3);
  });
});
