/**
 * Tests for ExcelConnector.
 * Uses sample XLSX fixture in tests/fixtures/excel/.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { ExcelConnector } from '../excel-connector.js';
import type { FileImportConfig } from '@fhirbridge/types';

const FIXTURES_DIR = path.resolve(__dirname, '../../../../../tests/fixtures/excel');
const FIXTURE_FILE = path.join(FIXTURES_DIR, 'sample-patient-data.xlsx');

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

describe('ExcelConnector', () => {
  it('throws ConnectorError when config type is not excel', async () => {
    const connector = new ExcelConnector();
    await expect(
      connector.connect({
        type: 'csv' as unknown as 'excel',
        filePath: FIXTURE_FILE,
        mapping: [],
      }),
    ).rejects.toThrow('Expected excel config');
  });

  it('throws ConnectorError when file does not exist', async () => {
    const connector = new ExcelConnector();
    await expect(
      connector.connect({
        type: 'excel',
        filePath: '/nonexistent/file.xlsx',
        mapping: [],
      }),
    ).rejects.toThrow();
  });

  it('rejects a file exceeding the compressed-size ceiling (zip-bomb guard)', async () => {
    // Sparse 51 MB file — logical size only, no real bytes written to disk.
    // mkdtemp: thư mục riêng tư unique, tránh predictable-path race trong temp dir chung.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhirbridge-xlsx-'));
    const bigPath = path.join(tmpDir, 'bomb.xlsx');
    const fd = fs.openSync(bigPath, 'w');
    fs.ftruncateSync(fd, 51 * 1024 * 1024);
    fs.closeSync(fd);

    try {
      const connector = new ExcelConnector();
      await expect(
        connector.connect({ type: 'excel', filePath: bigPath, mapping: [] }),
      ).rejects.toThrow(/limit/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('testConnection returns connected=false when not yet connected', async () => {
    const connector = new ExcelConnector();
    const status = await connector.testConnection();
    expect(status.connected).toBe(false);
  });

  it('getSheetNames returns empty array when not connected', () => {
    const connector = new ExcelConnector();
    expect(connector.getSheetNames()).toEqual([]);
  });

  it('throws when fetchPatientData called without connect()', async () => {
    const connector = new ExcelConnector();
    const gen = connector.fetchPatientData('P001');
    await expect(async () => {
      for await (const _ of gen) {
        /* noop */
      }
    }).rejects.toThrow();
  });

  describe('with fixture file', () => {
    let connector: ExcelConnector;
    const hasFixture = fs.existsSync(FIXTURE_FILE);

    beforeAll(async () => {
      if (!hasFixture) return;
      connector = new ExcelConnector();
      await connector.connect({
        type: 'excel',
        filePath: FIXTURE_FILE,
        mapping: PATIENT_MAPPING,
      });
    });

    afterAll(async () => {
      if (!hasFixture || !connector) return;
      await connector.disconnect();
    });

    it.skipIf(!hasFixture)('connect() succeeds with valid fixture file', async () => {
      const status = await connector.testConnection();
      expect(status.connected).toBe(true);
    });

    it.skipIf(!hasFixture)('testConnection returns sheet names in serverVersion', async () => {
      const status = await connector.testConnection();
      expect(status.serverVersion).toContain('Patients');
    });

    it.skipIf(!hasFixture)('getSheetNames returns Patients and Observations sheets', () => {
      const sheets = connector.getSheetNames();
      expect(sheets).toContain('Patients');
      expect(sheets).toContain('Observations');
    });

    it.skipIf(!hasFixture)(
      'fetchPatientData streams all 5 patient records from Patients sheet',
      async () => {
        const records = [];
        for await (const record of connector.fetchPatientData('')) {
          records.push(record);
        }
        expect(records.length).toBe(5);
        expect(records[0]!.resourceType).toBe('Patient');
        expect(records[0]!.source).toContain('sample-patient-data.xlsx');
      },
    );

    it.skipIf(!hasFixture)('fetchPatientData filters by patientIdColumn', async () => {
      await connector.disconnect();
      connector = new ExcelConnector();
      await connector.connect({
        type: 'excel',
        filePath: FIXTURE_FILE,
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

    it.skipIf(!hasFixture)('fetches from Observations sheet when sheetName specified', async () => {
      await connector.disconnect();
      connector = new ExcelConnector();

      const obsMapping: FileImportConfig['mapping'] = [
        {
          sourceColumn: 'patient_id',
          fhirPath: 'subject.reference',
          resourceType: 'Observation',
          transform: 'string',
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
      ];

      await connector.connect({
        type: 'excel',
        filePath: FIXTURE_FILE,
        mapping: obsMapping,
        sheetName: 'Observations',
      });

      const records = [];
      for await (const record of connector.fetchPatientData('')) {
        records.push(record);
      }
      expect(records.length).toBe(10);
      expect(records[0]!.resourceType).toBe('Observation');
    });

    it.skipIf(!hasFixture)('throws when sheetName does not exist in workbook', async () => {
      await connector.disconnect();
      connector = new ExcelConnector();
      await connector.connect({
        type: 'excel',
        filePath: FIXTURE_FILE,
        mapping: PATIENT_MAPPING,
        sheetName: 'NonExistentSheet',
      });

      await expect(async () => {
        for await (const _ of connector.fetchPatientData('')) {
          /* noop */
        }
      }).rejects.toThrow('Sheet not found');
    });

    it.skipIf(!hasFixture)('disconnect() clears state', async () => {
      await connector.disconnect();
      connector = new ExcelConnector();
      await connector.connect({
        type: 'excel',
        filePath: FIXTURE_FILE,
        mapping: PATIENT_MAPPING,
      });

      await connector.disconnect();

      const status = await connector.testConnection();
      expect(status.connected).toBe(false);
    });
  });
});
