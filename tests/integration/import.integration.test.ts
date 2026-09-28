/**
 * Integration tests — Connector routes.
 * Tests /api/v1/connectors/test (SSRF guard) and /api/v1/connectors/import
 * (multipart: file + column mapping as a text field or a file part).
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { containsRrn, validatePatient, validateResource } from '@fhirbridge/core';
import { createTestServer, userJwt, bearerHeader } from './helpers.js';

const REPO_ROOT = resolve(__dirname, '../..');
const example = (dir: 'column-mappings' | 'data', file: string) =>
  readFileSync(join(REPO_ROOT, 'examples', dir, file));

interface Part {
  name: string;
  value: string | Buffer;
  filename?: string;
  contentType?: string;
}

/** Build a multipart/form-data body (same wire format as curl -F / browsers). */
function multipart(parts: Part[]): { payload: Buffer; contentType: string } {
  const boundary = 'fhirbridge-integration-boundary';
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const disposition = p.filename
      ? `form-data; name="${p.name}"; filename="${p.filename}"`
      : `form-data; name="${p.name}"`;
    const type = p.filename
      ? `Content-Type: ${p.contentType ?? 'application/octet-stream'}\r\n`
      : '';
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\n${type}\r\n`),
      Buffer.isBuffer(p.value) ? p.value : Buffer.from(p.value),
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

let server: FastifyInstance;

beforeAll(async () => {
  server = await createTestServer();
});

afterAll(async () => {
  await server.close();
});

describe('POST /api/v1/connectors/test', () => {
  it('returns connection status object (external URL, connection may fail)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      headers: {
        authorization: bearerHeader(userJwt()),
        'content-type': 'application/json',
      },
      payload: {
        type: 'fhir-endpoint',
        config: { baseUrl: 'https://hapi.fhir.org/baseR4' },
      },
    });
    // Returns 200 either way (connected: true/false) — network errors are swallowed
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.connected).toBe('boolean');
    expect(body.checkedAt).toBeDefined();
  });

  it('blocks SSRF — 169.254.169.254 (AWS metadata)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      headers: {
        authorization: bearerHeader(userJwt()),
        'content-type': 'application/json',
      },
      payload: {
        type: 'fhir-endpoint',
        config: { baseUrl: 'http://169.254.169.254/latest/meta-data/' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(false);
    expect(body.error).toMatch(/Internal endpoints are not allowed/);
  });

  it('blocks SSRF — localhost', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      headers: {
        authorization: bearerHeader(userJwt()),
        'content-type': 'application/json',
      },
      payload: {
        type: 'fhir-endpoint',
        config: { baseUrl: 'http://localhost:9200/' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(false);
    expect(body.error).toMatch(/Internal endpoints are not allowed/);
  });

  it('blocks SSRF — private IP range 192.168.x.x', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      headers: {
        authorization: bearerHeader(userJwt()),
        'content-type': 'application/json',
      },
      payload: {
        type: 'fhir-endpoint',
        config: { baseUrl: 'http://192.168.1.100/fhir' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(false);
    expect(body.error).toMatch(/Private IP ranges are not allowed/);
  });

  it('returns 400 when config.baseUrl is missing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      headers: {
        authorization: bearerHeader(userJwt()),
        'content-type': 'application/json',
      },
      payload: {
        type: 'fhir-endpoint',
        config: {},
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'fhir-endpoint', config: { baseUrl: 'https://example.com' } },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/connectors/import', () => {
  it('returns 400 when request is not multipart', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/connectors/import',
      headers: {
        authorization: bearerHeader(userJwt()),
        'content-type': 'application/json',
      },
      payload: { data: 'not-multipart' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toMatch(/multipart/i);
  });

  it('returns 401 without auth', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/connectors/import',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  const importRequest = (parts: Part[]) => {
    const { payload, contentType } = multipart(parts);
    return server.inject({
      method: 'POST',
      url: '/api/v1/connectors/import',
      headers: { authorization: bearerHeader(userJwt()), 'content-type': contentType },
      payload,
    });
  };

  const krCsv: Part = {
    name: 'file',
    filename: 'kr-hospital.csv',
    contentType: 'text/csv',
    value: example('data', 'kr-hospital.csv'),
  };

  it('imports CSV with the mapping as a multipart text field', async () => {
    const res = await importRequest([
      krCsv,
      { name: 'mapping', value: example('column-mappings', 'csv-korea-hospital.json') },
    ]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message).toBe('Import complete');
    expect(body.resourceCount).toBe(14);
    expect(body.resourcesByType).toEqual({
      Patient: 3,
      Encounter: 4,
      Condition: 4,
      Observation: 3,
    });
    expect(body.bundle.entry).toHaveLength(14);
    for (const { resource } of body.bundle.entry) {
      const result =
        resource.resourceType === 'Patient'
          ? validatePatient(resource)
          : validateResource(resource);
      expect(result.valid).toBe(true);
    }
    // PIPA: no raw RRN anywhere in the response
    expect(containsRrn(res.body)).toBe(false);
  });

  it('imports CSV with the mapping as a file part named "mapping" (curl -F mapping=@file.json)', async () => {
    const res = await importRequest([
      {
        name: 'mapping',
        filename: 'csv-generic-hl7.json',
        contentType: 'application/json',
        value: example('column-mappings', 'csv-generic-hl7.json'),
      },
      {
        name: 'file',
        filename: 'generic-hl7.csv',
        contentType: 'text/csv',
        value: example('data', 'generic-hl7.csv'),
      },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().resourcesByType).toEqual({
      Patient: 3,
      Encounter: 4,
      Condition: 4,
      Observation: 3,
    });
  });

  it('imports the multi-sheet Excel example via an API key (x-api-key)', async () => {
    const { payload, contentType } = multipart([
      {
        name: 'file',
        filename: 'jp-clinic.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        value: example('data', 'jp-clinic.xlsx'),
      },
      { name: 'mapping', value: example('column-mappings', 'excel-japan-clinic.json') },
    ]);
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/connectors/import',
      headers: { 'x-api-key': 'test-key-1', 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().resourcesByType).toEqual({ Patient: 3, Encounter: 4, Condition: 4 });
  });

  it('returns 400 pointing to examples/column-mappings when no mapping is sent', async () => {
    const res = await importRequest([krCsv]);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/No column mapping provided.*examples\/column-mappings/);
  });

  it('returns 400 with the loader message for an invalid mapping', async () => {
    const res = await importRequest([
      krCsv,
      { name: 'mapping', value: JSON.stringify({ fields: { 'Patient.gender': { col: 'x' } } }) },
    ]);
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.issues).toEqual([
      'fields["Patient.gender"]: unknown key "col" (allowed: column, transform, format, valueMap, or "literal" alone)',
      'fields["Patient.gender"].column must be a non-empty string',
    ]);
  });
});
