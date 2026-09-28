/**
 * Tests for FhirEndpointConnector.
 * Does NOT test actual HTTP calls (see fhir-http-client.test.ts) — only interface
 * compliance and structural behavior.
 * The SSRF validator is mocked so tests are hermetic (no real DNS).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FhirEndpointConnector } from '../fhir-endpoint-connector.js';
import type { FhirEndpointConfig } from '@fhirbridge/types';

// Shared mocks for the FhirHttpClient instance methods.
const { requestMock, capabilityMock, postFormMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  capabilityMock: vi.fn(),
  postFormMock: vi.fn(),
}));

// Stub the HTTP client to avoid real HTTP (it is tested on its own in fhir-http-client.test.ts)
vi.mock('../fhir-http-client.js', () => ({
  FhirHttpClient: vi.fn().mockImplementation(() => ({
    capabilityStatement: capabilityMock,
    request: requestMock,
    close: vi.fn(),
    bearerToken: undefined,
  })),
  postFormForJson: postFormMock,
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

  describe('OAuth2 client credentials', () => {
    const OAUTH_CONFIG: FhirEndpointConfig = {
      ...BASE_CONFIG,
      clientId: 'client-a',
      clientSecret: 'secret-a',
      tokenEndpoint: 'https://auth.example.org/token',
    };

    it('posts the client credentials and sets the bearer token on the client', async () => {
      postFormMock.mockReset();
      postFormMock.mockResolvedValueOnce({ access_token: 'tok-123' });
      await connector.connect(OAUTH_CONFIG);

      const [url, form] = postFormMock.mock.calls[0]!;
      expect(url).toBe('https://auth.example.org/token');
      expect(Object.fromEntries(form as URLSearchParams)).toMatchObject({
        grant_type: 'client_credentials',
        client_id: 'client-a',
        client_secret: 'secret-a',
      });
      const client = (connector as unknown as { client: { bearerToken?: string } }).client;
      expect(client.bearerToken).toBe('tok-123');
    });

    it('fails clearly when the token endpoint returns no access_token', async () => {
      postFormMock.mockReset();
      postFormMock.mockResolvedValueOnce({ error: 'invalid_client' });
      await expect(connector.connect(OAUTH_CONFIG)).rejects.toThrow(/no access_token/);
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
