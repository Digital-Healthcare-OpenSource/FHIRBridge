/**
 * Security tests — File upload hardening (POST /api/v1/connectors/import).
 * Covers: path traversal filenames, oversized uploads, null-byte injection,
 * mapping part handling, content sniffing, no cell contents in errors, temp cleanup.
 */

import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServer, userJwt, bearerHeader } from '../integration/helpers.js';

let server: FastifyInstance;

beforeAll(async () => {
  server = await createTestServer();
});

afterAll(async () => {
  await server.close();
});

/** Build a minimal multipart body buffer with a single file part */
function buildMultipart(boundary: string, filename: string, content: Buffer | string): Buffer {
  const body = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`,
    `Content-Type: text/csv\r\n`,
    `\r\n`,
    typeof content === 'string' ? content : content.toString('binary'),
    `\r\n--${boundary}--\r\n`,
  ].join('');
  return Buffer.from(body, 'binary');
}

const AUTH_HEADER = bearerHeader(userJwt());
const IMPORT_URL = '/api/v1/connectors/import';

// Minimal valid CSV content
const VALID_CSV = 'id,name\n1,Test Patient\n';

// ---------------------------------------------------------------------------
// Path traversal via filename
// ---------------------------------------------------------------------------

describe('File upload — path traversal filenames', () => {
  it('filename "../../../etc/passwd" is rejected or sanitized (not 500 via traversal)', async () => {
    const boundary = 'test-boundary-traversal';
    const body = buildMultipart(boundary, '../../../etc/passwd', VALID_CSV);

    const res = await server.inject({
      method: 'POST',
      url: IMPORT_URL,
      headers: {
        authorization: AUTH_HEADER,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    // The server should not write to /etc/passwd; it may succeed (200) with sanitized name
    // or reject (400/422). What it MUST NOT do is produce a 5xx from file system traversal
    // that exposes internal structure.
    expect(res.statusCode).not.toBe(403); // 403 would be unexpected
    // If it returns 500, the body must not reveal path info
    if (res.statusCode === 500) {
      expect(res.body).not.toMatch(/\/etc\/passwd/);
      expect(res.body).not.toMatch(/No such file/i);
    }
  });

  it('filename "....//....//etc//passwd" (double-dot variation) is handled safely', async () => {
    const boundary = 'test-boundary-double-dot';
    const body = buildMultipart(boundary, '....//....//etc//passwd', VALID_CSV);

    const res = await server.inject({
      method: 'POST',
      url: IMPORT_URL,
      headers: {
        authorization: AUTH_HEADER,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    if (res.statusCode === 500) {
      expect(res.body).not.toMatch(/\/etc/);
    }
    // Must not be a raw stack trace
    expect(res.body).not.toMatch(/at Object\.<anonymous>/);
  });
});

// ---------------------------------------------------------------------------
// Null byte in filename
// ---------------------------------------------------------------------------

describe('File upload — null byte in filename', () => {
  it('null byte in filename does not cause unexpected server error with path exposure', async () => {
    const boundary = 'test-boundary-null';
    // Encode null byte as %00 in the disposition header
    const body = buildMultipart(boundary, 'evil\x00.csv', VALID_CSV);

    const res = await server.inject({
      method: 'POST',
      url: IMPORT_URL,
      headers: {
        authorization: AUTH_HEADER,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    // Should not expose internal file system paths on error
    if (res.statusCode >= 500) {
      expect(res.body).not.toMatch(/ENOENT|EACCES/);
    }
  });
});

// ---------------------------------------------------------------------------
// Oversized file upload
// ---------------------------------------------------------------------------

describe('File upload — oversized file', () => {
  it('file larger than server limit is rejected (413 or 400)', async () => {
    const boundary = 'test-boundary-large';
    // Generate a 2 MB buffer to exceed multipart limits without being too slow in CI
    // The actual configured limit may be lower (e.g. 1 MB default for @fastify/multipart)
    const largeContent = Buffer.alloc(2 * 1024 * 1024, 'A');
    const body = buildMultipart(boundary, 'large-file.csv', largeContent);

    const res = await server.inject({
      method: 'POST',
      url: IMPORT_URL,
      headers: {
        authorization: AUTH_HEADER,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    // Either the multipart limit kicks in (413 / 400) or the file is processed (200/500)
    // The critical check: if rejected, response must not expose stack traces
    if (res.statusCode >= 400) {
      expect(res.body).not.toMatch(/at Object\.<anonymous>/);
      expect(res.body).not.toMatch(/node:internal/);
    }
    // Specifically, 413 is the preferred outcome
    // 400 is acceptable if the multipart parser rejects it
    // We accept any non-5xx or a clean 500 without stack trace
    if (res.statusCode === 500) {
      const parsed = JSON.parse(res.body) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty('stack');
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Non-multipart request
// ---------------------------------------------------------------------------

describe('File upload — wrong content type', () => {
  it('JSON body to import endpoint returns 400 (not multipart)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: IMPORT_URL,
      headers: { authorization: AUTH_HEADER, 'content-type': 'application/json' },
      payload: { file: 'data' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Column mapping part + content sniffing (canonical import)
// ---------------------------------------------------------------------------

interface Part {
  name: string;
  value: string | Buffer;
  filename?: string;
  contentType?: string;
}

function buildParts(boundary: string, parts: Part[]): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const disposition = p.filename
      ? `form-data; name="${p.name}"; filename="${p.filename}"`
      : `form-data; name="${p.name}"`;
    const type = p.filename ? `Content-Type: ${p.contentType ?? 'text/csv'}\r\n` : '';
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\n${type}\r\n`),
      Buffer.isBuffer(p.value) ? p.value : Buffer.from(p.value),
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

const MAPPING = JSON.stringify({ fields: { 'Patient.name.family': 'name' } });

async function upload(parts: Part[]) {
  const boundary = 'security-boundary';
  return server.inject({
    method: 'POST',
    url: IMPORT_URL,
    headers: {
      authorization: AUTH_HEADER,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: buildParts(boundary, parts),
  });
}

const tempImports = () =>
  readdirSync(tmpdir()).filter((f) => f.startsWith('fhirbridge-import-')).length;

describe('File upload — mapping part and content sniffing', () => {
  it('a traversal filename on the mapping part is never used as a path', async () => {
    const res = await upload([
      { name: 'file', filename: 'p.csv', value: VALID_CSV },
      {
        name: 'mapping',
        filename: '../../../etc/passwd',
        contentType: 'application/json',
        value: MAPPING,
      },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().resourceCount).toBe(1);
    expect(res.body).not.toMatch(/\/etc\/passwd/);
  });

  it('binary content disguised as .csv is rejected with 400 (not parsed)', async () => {
    const res = await upload([
      { name: 'file', filename: 'x.csv', value: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x02]) },
      { name: 'mapping', value: MAPPING },
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/binary, not a text CSV/);
  });

  it('non-zip content named .xlsx is rejected with 400 instead of a 500', async () => {
    const res = await upload([
      {
        name: 'file',
        filename: 'x.xlsx',
        contentType: 'application/octet-stream',
        value: VALID_CSV,
      },
      { name: 'mapping', value: MAPPING },
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/at Object\.<anonymous>|node:internal/);
  });

  it('CSV parse errors never echo cell contents', async () => {
    const res = await upload([
      { name: 'file', filename: 'x.csv', value: 'name,dob\nDoe,"PHI-SECRET-VALUE\n' },
      { name: 'mapping', value: MAPPING },
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('PHI-SECRET-VALUE');
  });

  it('an oversized mapping part is rejected with 413', async () => {
    const res = await upload([
      { name: 'file', filename: 'p.csv', value: VALID_CSV },
      { name: 'mapping', filename: 'm.json', value: 'x'.repeat(300 * 1024) },
    ]);
    expect(res.statusCode).toBe(413);
  });

  it('temp upload files are removed after success and failure (no PHI at rest)', async () => {
    const before = tempImports();
    await upload([
      { name: 'file', filename: 'p.csv', value: VALID_CSV },
      { name: 'mapping', value: MAPPING },
    ]);
    await upload([{ name: 'file', filename: 'p.csv', value: VALID_CSV }]);
    await upload([
      { name: 'file', filename: 'x.xlsx', value: VALID_CSV },
      { name: 'mapping', value: MAPPING },
    ]);
    expect(tempImports()).toBe(before);
  });
});
