/**
 * Tests for CsvConnector.
 * Uses sample CSV fixtures in tests/fixtures/csv/.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import iconv from 'iconv-lite';
import { CsvConnector } from '../csv-connector.js';
import type { FileImportConfig } from '@fhirbridge/types';

const NAME_MAPPING: FileImportConfig['mapping'] = [
  { sourceColumn: 'patient_id', fhirPath: 'id', resourceType: 'Patient', transform: 'string' },
  { sourceColumn: 'name', fhirPath: 'name[0].text', resourceType: 'Patient', transform: 'string' },
];

async function collect(connector: CsvConnector) {
  const records = [];
  for await (const record of connector.fetchPatientData('')) {
    records.push(record);
  }
  return records;
}

const FIXTURES_DIR = path.resolve(__dirname, '../../../../../tests/fixtures/csv');
const PATIENTS_CSV = path.join(FIXTURES_DIR, 'sample-patients.csv');
const OBSERVATIONS_CSV = path.join(FIXTURES_DIR, 'sample-observations.csv');

const PATIENT_MAPPING: FileImportConfig['mapping'] = [
  { sourceColumn: 'patient_id', fhirPath: 'id', resourceType: 'Patient', transform: 'string' },
  {
    sourceColumn: 'first_name',
    fhirPath: 'name[0].given[0]',
    resourceType: 'Patient',
    transform: 'string',
  },
  {
    sourceColumn: 'last_name',
    fhirPath: 'name[0].family',
    resourceType: 'Patient',
    transform: 'string',
  },
  { sourceColumn: 'birth_date', fhirPath: 'birthDate', resourceType: 'Patient', transform: 'date' },
  { sourceColumn: 'gender', fhirPath: 'gender', resourceType: 'Patient', transform: 'string' },
];

describe('CsvConnector', () => {
  it('should fail connect() when file does not exist', async () => {
    const connector = new CsvConnector();
    await expect(
      connector.connect({
        type: 'csv',
        filePath: '/nonexistent/file.csv',
        mapping: PATIENT_MAPPING,
      }),
    ).rejects.toThrow();
  });

  it('should fail connect() with wrong config type', async () => {
    const connector = new CsvConnector();
    await expect(
      connector.connect({
        type: 'excel' as unknown as 'csv',
        filePath: PATIENTS_CSV,
        mapping: [],
      }),
    ).rejects.toThrow('Expected csv config');
  });

  it('testConnection() returns not connected when not connected', async () => {
    const connector = new CsvConnector();
    const status = await connector.testConnection();
    expect(status.connected).toBe(false);
  });

  describe('with patients CSV', () => {
    let connector: CsvConnector;

    beforeAll(async () => {
      connector = new CsvConnector();
      await connector.connect({
        type: 'csv',
        filePath: PATIENTS_CSV,
        mapping: PATIENT_MAPPING,
      });
    });

    afterAll(async () => {
      await connector.disconnect();
    });

    it('testConnection() returns connected = true', async () => {
      const status = await connector.testConnection();
      expect(status.connected).toBe(true);
      expect(status.checkedAt).toBeTruthy();
    });

    it('streams all patient records without patientId filter', async () => {
      const records = [];
      for await (const record of connector.fetchPatientData('')) {
        records.push(record);
      }
      // 5 patients × 1 resource type = 5 records
      expect(records.length).toBe(5);
      expect(records[0]!.resourceType).toBe('Patient');
      expect(records[0]!.source).toContain('sample-patients.csv');
    });

    it('filters records by patientId when patientIdColumn is set', async () => {
      await connector.disconnect();
      connector = new CsvConnector();
      await connector.connect({
        type: 'csv',
        filePath: PATIENTS_CSV,
        mapping: PATIENT_MAPPING,
        patientIdColumn: 'patient_id',
      });

      const records = [];
      for await (const record of connector.fetchPatientData('P001')) {
        records.push(record);
      }
      expect(records.length).toBe(1);
      expect(records[0]!.data['id']).toBe('P001');
    });

    it('applies date transform correctly', async () => {
      await connector.disconnect();
      connector = new CsvConnector();
      await connector.connect({
        type: 'csv',
        filePath: PATIENTS_CSV,
        mapping: PATIENT_MAPPING,
        patientIdColumn: 'patient_id',
      });

      const records = [];
      for await (const record of connector.fetchPatientData('P001')) {
        records.push(record);
      }

      expect(records[0]!.data['birthDate']).toBe('1985-03-15');
    });

    it('returns headers after connect()', async () => {
      expect(connector.getHeaders().length).toBeGreaterThan(0);
    });
  });

  describe('with observations CSV', () => {
    it('streams observation records', async () => {
      const obsMapping: FileImportConfig['mapping'] = [
        {
          sourceColumn: 'patient_id',
          fhirPath: 'subject.reference',
          resourceType: 'Observation',
          transform: 'string',
        },
        {
          sourceColumn: 'observation_date',
          fhirPath: 'effectiveDateTime',
          resourceType: 'Observation',
          transform: 'date',
        },
        {
          sourceColumn: 'value',
          fhirPath: 'valueQuantity.value',
          resourceType: 'Observation',
          transform: 'number',
        },
        {
          sourceColumn: 'unit',
          fhirPath: 'valueQuantity.unit',
          resourceType: 'Observation',
          transform: 'string',
        },
        {
          sourceColumn: 'status',
          fhirPath: 'status',
          resourceType: 'Observation',
          transform: 'string',
        },
      ];

      const connector = new CsvConnector();
      await connector.connect({
        type: 'csv',
        filePath: OBSERVATIONS_CSV,
        mapping: obsMapping,
      });

      const records = [];
      for await (const record of connector.fetchPatientData('')) {
        records.push(record);
      }

      await connector.disconnect();

      expect(records.length).toBe(10);
      expect(records[0]!.resourceType).toBe('Observation');
      // Numeric transform
      expect(typeof records[0]!.data['valueQuantity.value']).toBe('number');
    });
  });

  describe('encoding decode (golden fixtures)', () => {
    // mkdtemp tạo thư mục riêng tư unique — tránh predictable-path race trong temp dir chung.
    function makeTempCsv(name: string, content: Buffer | string): { tmp: string; dir: string } {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhirbridge-csv-'));
      const tmp = path.join(dir, name);
      fs.writeFileSync(tmp, content);
      return { tmp, dir };
    }

    it('decodes a Shift-JIS CSV correctly (JP HIS default)', async () => {
      // Golden bytes produced by a real Shift-JIS encoder; the connector must
      // decode them via iconv-lite (Node BufferEncoding has no Shift-JIS).
      const csv = 'patient_id,name\nP001,テスト\n';
      const { tmp, dir } = makeTempCsv('sjis.csv', iconv.encode(csv, 'shift_jis'));

      try {
        const connector = new CsvConnector();
        await connector.connect({
          type: 'csv',
          filePath: tmp,
          encoding: 'shift_jis',
          mapping: NAME_MAPPING,
        });
        const records = await collect(connector);
        await connector.disconnect();

        expect(records[0]!.data['name[0].text']).toBe('テスト');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('preserves Vietnamese diacritics in a UTF-8 CSV', async () => {
      const csv = 'patient_id,name\nP001,Nguyễn Văn Tú\n';
      const { tmp, dir } = makeTempCsv('vi.csv', Buffer.from(csv, 'utf-8'));

      try {
        const connector = new CsvConnector();
        await connector.connect({
          type: 'csv',
          filePath: tmp,
          encoding: 'utf-8',
          mapping: NAME_MAPPING,
        });
        const records = await collect(connector);
        await connector.disconnect();

        expect(records[0]!.data['name[0].text']).toBe('Nguyễn Văn Tú');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('rejects an unsupported encoding at connect (fail-fast, no silent mojibake)', async () => {
      const { tmp, dir } = makeTempCsv('enc.csv', 'patient_id,name\nP001,x\n');

      try {
        const connector = new CsvConnector();
        await expect(
          connector.connect({
            type: 'csv',
            filePath: tmp,
            encoding: 'ebcdic' as unknown as FileImportConfig['encoding'],
            mapping: NAME_MAPPING,
          }),
        ).rejects.toThrow(/Unsupported encoding/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
