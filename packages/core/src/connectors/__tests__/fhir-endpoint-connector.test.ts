/**
 * Tests for FhirEndpointConnector.
 * Does NOT test actual HTTP calls — only interface compliance and structural behavior.
 * The SSRF validator is mocked so tests are hermetic (no real DNS).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FhirEndpointConnector } from '../fhir-endpoint-connector.js';
import type { FhirEndpointConfig } from '@fhirbridge/types';

// Shared mocks for the fhir-kit-client instance methods.
const { requestMock, capabilityMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  capabilityMock: vi.fn(),
}));

// Stub fhir-kit-client to avoid real HTTP
vi.mock('fhir-kit-client', () => ({
  default: vi.fn().mockImplementation(() => ({
    capabilityStatement: capabilityMock,
    request: requestMock,
  })),
}));

// Stub the DNS-aware SSRF validator — block private/metadata targets deterministically.
vi.mock('../../security/ssrf-validator.js', () => ({
  validateBaseUrlWithDns: vi.fn(async (url: string) => {
    if (/169\.254\.169\.254|localhost|127\.0\.0\.1|(?:^|\/\/)10\.|192\.168\.|metadata/.test(url)) {
      return { ok: false, reason: `blocked target ${url}` };
    }
    return { ok: true };
  }),
  validateBaseUrl: vi.fn(() => ({ ok: true })),
}));

const BASE_CONFIG: FhirEndpointConfig = {
  type: 'fhir-endpoint',
  baseUrl: 'https://hapi.fhir.org/baseR4',
};

function emptyBundle() {
  return { resourceType: 'Bundle', entry: [], link: [] };
}

describe('FhirEndpointConnector', () => {
  let connector: FhirEndpointConnector;

  beforeEach(() => {
    connector = new FhirEndpointConnector();
    requestMock.mockReset();
    requestMock.mockResolvedValue(emptyBundle());
    capabilityMock.mockReset();
    capabilityMock.mockResolvedValue({ fhirVersion: '4.0.1' });
  });

  describe('interface compliance', () => {
    it('has type "fhir-endpoint"', () => {
      expect(connector.type).toBe('fhir-endpoint');
    });

    it('has connect method', () => {
      expect(typeof connector.connect).toBe('function');
    });

    it('has testConnection method', () => {
      expect(typeof connector.testConnection).toBe('function');
    });

    it('has fetchPatientData method', () => {
      expect(typeof connector.fetchPatientData).toBe('function');
    });

    it('has disconnect method', () => {
      expect(typeof connector.disconnect).toBe('function');
    });
  });

  describe('connect()', () => {
    it('stores config and resolves without error for valid fhir-endpoint config', async () => {
      await expect(connector.connect(BASE_CONFIG)).resolves.toBeUndefined();
    });

    it('throws ConnectorError when config type is not fhir-endpoint', async () => {
      const wrongConfig = {
        type: 'csv',
        filePath: '/tmp/data.csv',
      } as unknown as FhirEndpointConfig;
      await expect(connector.connect(wrongConfig)).rejects.toThrow('Expected fhir-endpoint config');
    });
  });

  describe('testConnection()', () => {
    it('returns ConnectionStatus with connected:true after successful connect', async () => {
      await connector.connect(BASE_CONFIG);
      const status = await connector.testConnection();

      expect(status).toMatchObject({ connected: true });
      expect(typeof status.checkedAt).toBe('string');
    });

    it('returns ConnectionStatus object (may fail) when called without connect', async () => {
      const status = await connector.testConnection();
      expect(typeof status.connected).toBe('boolean');
      expect(typeof status.checkedAt).toBe('string');
    });
  });

  describe('disconnect()', () => {
    it('resolves without error', async () => {
      await connector.connect(BASE_CONFIG);
      await expect(connector.disconnect()).resolves.toBeUndefined();
    });

    it('fetchPatientData throws ConnectorError after disconnect', async () => {
      await connector.connect(BASE_CONFIG);
      await connector.disconnect();

      const gen = connector.fetchPatientData('patient-123');
      await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow('connect()');
    });
  });

  describe('SSRF protection', () => {
    it('rejects connect when tokenEndpoint resolves to a cloud-metadata IP', async () => {
      await expect(
        connector.connect({
          ...BASE_CONFIG,
          clientId: 'c',
          clientSecret: 's',
          tokenEndpoint: 'http://169.254.169.254/token',
        }),
      ).rejects.toThrow(/Blocked tokenEndpoint/);
    });

    it('follows a same-origin pagination next-link', async () => {
      await connector.connect(BASE_CONFIG);
      requestMock.mockReset();
      requestMock
        .mockResolvedValueOnce({
          resourceType: 'Bundle',
          entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }],
          link: [{ relation: 'next', url: 'https://hapi.fhir.org/baseR4?page=2' }],
        })
        .mockResolvedValueOnce({
          resourceType: 'Bundle',
          entry: [{ resource: { resourceType: 'Observation', id: 'o1' } }],
          link: [],
        });

      const records = [];
      for await (const record of connector.fetchPatientData('p1')) {
        records.push(record);
      }

      expect(records.map((r) => r.resourceType)).toEqual(['Patient', 'Observation']);
      expect(requestMock).toHaveBeenCalledTimes(2);
    });

    it('rejects a cross-origin pagination next-link pointing at a metadata IP', async () => {
      await connector.connect(BASE_CONFIG);
      requestMock.mockReset();
      requestMock.mockResolvedValueOnce({
        resourceType: 'Bundle',
        entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }],
        link: [{ relation: 'next', url: 'http://169.254.169.254/latest/meta-data' }],
      });

      const drain = async () => {
        for await (const _ of connector.fetchPatientData('p1')) {
          void _;
        }
      };
      await expect(drain()).rejects.toThrow(/Cross-origin|Blocked/);
    });
  });
});
