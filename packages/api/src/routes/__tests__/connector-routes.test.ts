/**
 * Tests for POST /api/v1/connectors/test and POST /api/v1/connectors/import.
 * Uses Fastify inject() — no real network connections.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import fastifyMultipart from '@fastify/multipart';
import { containsRrn, validateResource } from '@fhirbridge/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { connectorRoutes } from '../connector-routes.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(connectorRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('POST /api/v1/connectors/test', () => {
  it('returns a connection status object', async () => {
    // Uses an external domain — the connector will fail to connect but return a status object
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      payload: {
        type: 'fhir-endpoint',
        config: { baseUrl: 'https://hapi.fhir.org/baseR4', authType: 'none' },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Either connected or failed — both produce a valid status object
    expect(typeof body.connected).toBe('boolean');
    expect(body.checkedAt).toBeDefined();
  });

  it('returns connected: false with error message for SSRF-blocked localhost', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      payload: {
        type: 'fhir-endpoint',
        config: { baseUrl: 'http://localhost:8080/fhir', authType: 'none' },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.connected).toBe(false);
    expect(body.error).toMatch(/Internal endpoints are not allowed/i);
  });

  it('blocks private 192.168 IP (SSRF)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      payload: {
        type: 'fhir-endpoint',
        config: { baseUrl: 'http://192.168.0.1/fhir', authType: 'none' },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.connected).toBe(false);
    expect(body.error).toMatch(/Private IP ranges are not allowed/i);
  });

  it('returns 400 for invalid request body (missing type)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      payload: { config: { baseUrl: 'https://example.com/fhir' } },
    });
    // Fastify schema validation returns 400
    expect(response.statusCode).toBe(400);
  });
});

// ── POST /api/v1/connectors/import ───────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '../../../../..');
const MAPPINGS_DIR = join(REPO_ROOT, 'examples/column-mappings');
const DATA_DIR = join(REPO_ROOT, 'examples/data');
const readMapping = (file: string) => readFileSync(join(MAPPINGS_DIR, file), 'utf8');

interface Part {
  name: string;
  value: string | Buffer;
  filename?: string;
  contentType?: string;
}

/** Build a multipart/form-data body from text fields and file parts. */
function multipart(parts: Part[]): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----fhirbridge-test-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const disposition = p.filename
      ? `form-data; name="${p.name}"; filename="${p.filename}"`
      : `form-data; name="${p.name}"`;
    const head =
      `--${boundary}\r\nContent-Disposition: ${disposition}\r\n` +
      (p.filename ? `Content-Type: ${p.contentType ?? 'application/octet-stream'}\r\n` : '') +
      '\r\n';
    chunks.push(
      Buffer.from(head),
      Buffer.isBuffer(p.value) ? p.value : Buffer.from(p.value),
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const csvFile = (name = 'kr-hospital.csv'): Part => ({
  name: 'file',
  filename: name,
  contentType: 'text/csv',
  value: readFileSync(join(DATA_DIR, name)),
});

describe('POST /api/v1/connectors/import', () => {
  let importApp: FastifyInstance;
  const SECRET = 'route-test-hmac-secret-0123456789abcdef';

  beforeAll(async () => {
    importApp = Fastify({ logger: false });
    await importApp.register(fastifyMultipart, { limits: { fileSize: 5 * 1024 * 1024 } });
    await importApp.register(connectorRoutes, { hmacSecret: SECRET });
    await importApp.ready();
  });

  afterAll(async () => {
    await importApp.close();
  });

  const post = (parts: Part[]) =>
    importApp.inject({ method: 'POST', url: '/api/v1/connectors/import', ...multipart(parts) });

  it('imports with the mapping as a text field (response shape kept)', async () => {
    const res = await post([
      csvFile(),
      { name: 'mapping', value: readMapping('csv-korea-hospital.json') },
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
    expect(body.rowsRead).toBe(4);
    expect(body.warnings).toEqual([]);
    expect(body.bundle.resourceType).toBe('Bundle');
    expect(body.bundle.entry).toHaveLength(14);
    for (const e of body.bundle.entry) expect(validateResource(e.resource).valid).toBe(true);
  });

  it('imports with the mapping as a file part named "mapping" (curl -F mapping=@file.json)', async () => {
    const res = await post([
      {
        name: 'mapping',
        filename: 'csv-vneid-vn.json',
        contentType: 'application/json',
        value: readMapping('csv-vneid-vn.json'),
      },
      csvFile('vn-hospital.csv'),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().resourceCount).toBe(14);
  });

  it('imports the Excel example (multi-sheet) and honours the "sheet" field', async () => {
    const xlsx: Part = {
      name: 'file',
      filename: 'jp-clinic.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      value: readFileSync(join(DATA_DIR, 'jp-clinic.xlsx')),
    };
    const res = await post([
      xlsx,
      { name: 'mapping', value: readMapping('excel-japan-clinic.json') },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().resourcesByType).toEqual({ Patient: 3, Encounter: 4, Condition: 4 });

    const patientsOnly = JSON.stringify({
      patientId: '患者番号',
      fields: { 'Patient.name.family': '姓' },
    });
    const sheetRes = await post([
      xlsx,
      { name: 'mapping', value: patientsOnly },
      { name: 'sheet', value: '患者' },
    ]);
    expect(sheetRes.statusCode).toBe(200);
    expect(sheetRes.json().resourcesByType).toEqual({ Patient: 3 });

    const missing = await post([
      xlsx,
      { name: 'mapping', value: patientsOnly },
      { name: 'sheet', value: 'Nope' },
    ]);
    expect(missing.statusCode).toBe(422);
    expect(missing.json().message).toMatch(/Sheet not found: "Nope"/);
  });

  it('never returns a raw RRN (hashed with the configured secret)', async () => {
    const res = await post([
      csvFile(),
      { name: 'mapping', value: readMapping('csv-korea-hospital.json') },
    ]);
    expect(containsRrn(res.body)).toBe(false);
    expect(res.body).not.toContain('######-*******');
  });

  it('accepts the legacy {mappings: [...]} format and reports the conversion', async () => {
    const res = await post([
      {
        name: 'file',
        filename: 'p.csv',
        contentType: 'text/csv',
        value: readFileSync(join(REPO_ROOT, 'tests/fixtures/csv/sample-patients.csv')),
      },
      {
        name: 'mapping',
        value: readFileSync(join(REPO_ROOT, 'tests/fixtures/csv/mapping-config.json')),
      },
    ]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.resourcesByType).toEqual({ Patient: 5 });
    expect(body.mappingNotices.join('\n')).toMatch(/legacy "mappings" list was converted/);
  });

  it('400 with a pointer to examples/column-mappings when no mapping is sent', async () => {
    const res = await post([csvFile()]);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(
      /No column mapping provided\. .*"mapping".*examples\/column-mappings/,
    );
  });

  it('400 with every problem when the mapping is invalid', async () => {
    const res = await post([
      csvFile(),
      {
        name: 'mapping',
        value: JSON.stringify({ fields: { 'Patient.nmae': 'x' }, timezone: 'KST' }),
      },
    ]);
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toMatch(/^Invalid column mapping \(2 problems\)/);
    expect(body.issues).toHaveLength(2);

    const notJson = await post([csvFile(), { name: 'mapping', value: '{nope' }]);
    expect(notJson.statusCode).toBe(400);
    expect(notJson.json().message).toMatch(/mapping is not valid JSON/);
  });

  it('422 when the mapping does not match the file, or produces nothing', async () => {
    const mismatch = await post([
      csvFile('vn-hospital.csv'),
      { name: 'mapping', value: readMapping('csv-korea-hospital.json') },
    ]);
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().message).toMatch(
      /patientId column "환자ID" was not found .* File columns: "VNEID"/,
    );

    const nothing = await post([
      csvFile('vn-hospital.csv'),
      {
        name: 'mapping',
        value: JSON.stringify({ fields: { 'Patient.name.given': 'HoTen_Given' } }),
      },
    ]);
    expect(nothing.statusCode).toBe(422);
    const body = nothing.json();
    expect(body.message).toMatch(/^No FHIR resources were produced from 4 row\(s\)/);
    expect(body.warningCount).toBe(4);
    expect(body.warnings[0]).toMatch(/^row 2: Patient dropped/);
  });

  it('400 for a missing file, an unexpected file field, or a second file', async () => {
    const noFile = await post([{ name: 'mapping', value: readMapping('csv-korea-hospital.json') }]);
    expect(noFile.statusCode).toBe(400);
    expect(noFile.json().message).toMatch(/No file uploaded/);

    const wrongField = await post([
      { ...csvFile(), name: 'upload' },
      { name: 'mapping', value: readMapping('csv-korea-hospital.json') },
    ]);
    expect(wrongField.statusCode).toBe(400);
    expect(wrongField.json().message).toMatch(/Unexpected file field "upload"/);

    const twoFiles = await post([csvFile(), csvFile(), { name: 'mapping', value: '{}' }]);
    expect(twoFiles.statusCode).toBe(400);
    expect(twoFiles.json().message).toMatch(/Only one "file" part/);
  });

  it('keeps the file-type check and adds content sniffing (magic bytes)', async () => {
    const mapping: Part = { name: 'mapping', value: readMapping('csv-korea-hospital.json') };
    const pdf = await post([
      { name: 'file', filename: 'x.pdf', contentType: 'application/pdf', value: '%PDF-1.4' },
      mapping,
    ]);
    expect(pdf.statusCode).toBe(400);
    expect(pdf.json().message).toMatch(/Unsupported file type/);

    const fakeXlsx = await post([
      { name: 'file', filename: 'x.xlsx', value: 'a,b\n1,2\n' },
      mapping,
    ]);
    expect(fakeXlsx.statusCode).toBe(400);
    expect(fakeXlsx.json().message).toBe('File content is not an .xlsx workbook');

    const binaryCsv = await post([
      { name: 'file', filename: 'x.csv', value: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]) },
      mapping,
    ]);
    expect(binaryCsv.statusCode).toBe(400);
    expect(binaryCsv.json().message).toMatch(/binary, not a text CSV/);
  });

  it('413 when the mapping part is larger than the limit', async () => {
    const huge = JSON.stringify({
      fields: { 'Patient.name.family': 'x' },
      description: 'x'.repeat(300 * 1024),
    });
    const res = await post([csvFile(), { name: 'mapping', filename: 'm.json', value: huge }]);
    expect(res.statusCode).toBe(413);
    expect(res.json().message).toMatch(/Mapping exceeds \d+ bytes/);
  });

  it('400 for non-multipart requests', async () => {
    const res = await importApp.inject({
      method: 'POST',
      url: '/api/v1/connectors/import',
      payload: { mapping: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Expected multipart/form-data');
  });
});
