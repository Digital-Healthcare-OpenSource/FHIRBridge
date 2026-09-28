/**
 * Tests for HisConnector interface compliance across all connector implementations.
 * Verifies that CsvConnector, ExcelConnector, and FhirEndpointConnector all
 * satisfy the HisConnector contract.
 */

import { describe, it, expect, vi } from 'vitest';
import { CsvConnector } from '../csv-connector.js';
import { ExcelConnector } from '../excel-connector.js';
import { FhirEndpointConnector } from '../fhir-endpoint-connector.js';
import type { HisConnector } from '../his-connector-interface.js';

// Stub external dependencies — not testing actual I/O or HTTP
vi.mock('../fhir-http-client.js', () => ({
  FhirHttpClient: vi.fn().mockImplementation(() => ({
    capabilityStatement: vi.fn().mockResolvedValue({ fhirVersion: '4.0.1' }),
    request: vi.fn().mockResolvedValue({ resourceType: 'Bundle', entry: [] }),
    close: vi.fn(),
  })),
  postFormForJson: vi.fn(),
}));

/** Verify an object satisfies the HisConnector interface shape */
function assertHisConnectorShape(connector: unknown): void {
  const c = connector as HisConnector;
  expect(typeof c.type).toBe('string');
  expect(typeof c.connect).toBe('function');
  expect(typeof c.testConnection).toBe('function');
  expect(typeof c.fetchPatientData).toBe('function');
  expect(typeof c.disconnect).toBe('function');
}

describe('HisConnector interface compliance', () => {
  describe('CsvConnector', () => {
    it('has type "csv"', () => {
      const connector = new CsvConnector();
      expect(connector.type).toBe('csv');
    });

    it('satisfies HisConnector interface', () => {
      assertHisConnectorShape(new CsvConnector());
    });
  });

  describe('ExcelConnector', () => {
    it('has type "excel"', () => {
      const connector = new ExcelConnector();
      expect(connector.type).toBe('excel');
    });

    it('satisfies HisConnector interface', () => {
      assertHisConnectorShape(new ExcelConnector());
    });
  });

  describe('FhirEndpointConnector', () => {
    it('has type "fhir-endpoint"', () => {
      const connector = new FhirEndpointConnector();
      expect(connector.type).toBe('fhir-endpoint');
    });

    it('satisfies HisConnector interface', () => {
      assertHisConnectorShape(new FhirEndpointConnector());
    });
  });

  describe('connector type discriminants are distinct', () => {
    it('each connector has a unique type value', () => {
      const types = [
        new CsvConnector().type,
        new ExcelConnector().type,
        new FhirEndpointConnector().type,
      ];
      const uniqueTypes = new Set(types);
      expect(uniqueTypes.size).toBe(3);
    });
  });
});
