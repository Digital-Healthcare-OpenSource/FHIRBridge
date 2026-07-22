/**
 * Security tests — XSS injection prevention.
 * Verifies that user-supplied string inputs are never reflected back unescaped.
 */

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

/** Checks that raw unescaped <script> is absent from the JSON string */
function containsUnescapedScript(body: string): boolean {
  // JSON.stringify always encodes < as \u003c when using safe serializers.
  // Here we check if the literal tag leaks into the raw response bytes.
  return body.includes('<script>') || body.includes('</script>');
}

const PAID_HEADERS = {
  authorization: bearerHeader(userJwt()),
  'content-type': 'application/json',
};

const XSS_SCRIPT = '<script>alert(1)</script>';
const XSS_IMG = '<img src=x onerror=alert(1)>';
const XSS_EVENT = '" onmouseover="alert(1)';

describe('XSS — POST /api/v1/export patientId field', () => {
  it('script tag in patientId is not reflected unescaped', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/export',
      headers: PAID_HEADERS,
      payload: {
        patientId: XSS_SCRIPT,
        connectorConfig: { type: 'fhir-endpoint', baseUrl: 'https://hapi.fhir.org/baseR4' },
      },
    });
    expect(containsUnescapedScript(res.body)).toBe(false);
  });

  it('img onerror payload in patientId is not reflected unescaped', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/export',
      headers: PAID_HEADERS,
      payload: {
        patientId: XSS_IMG,
        connectorConfig: { type: 'fhir-endpoint', baseUrl: 'https://hapi.fhir.org/baseR4' },
      },
    });
    // The raw tag must not leak into the response body
    expect(res.body.includes('<img')).toBe(false);
  });

  it('event-handler injection in patientId does not leak', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/export',
      headers: PAID_HEADERS,
      payload: {
        patientId: XSS_EVENT,
        connectorConfig: { type: 'fhir-endpoint', baseUrl: 'https://hapi.fhir.org/baseR4' },
      },
    });
    expect(res.body.includes('onerror')).toBe(false);
    expect(res.body.includes('onmouseover')).toBe(false);
  });
});

describe('XSS — POST /api/v1/connectors/test baseUrl field', () => {
  it('script tag in baseUrl does not appear in error response unescaped', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      headers: PAID_HEADERS,
      payload: {
        type: 'fhir-endpoint',
        config: { type: 'fhir-endpoint', baseUrl: `https://example.com/${XSS_SCRIPT}` },
      },
    });
    // Whether it's a 400, 422 or 200-error, the raw tag must not appear
    expect(containsUnescapedScript(res.body)).toBe(false);
  });

  it('XSS in baseUrl hostname portion is rejected or sanitized', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      headers: PAID_HEADERS,
      payload: {
        type: 'fhir-endpoint',
        config: { type: 'fhir-endpoint', baseUrl: `javascript:${XSS_SCRIPT}` },
      },
    });
    expect(containsUnescapedScript(res.body)).toBe(false);
    // Non-http scheme bị từ chối: route connectors/test trả 200 với
    // connected:false trong body (contract hiện tại), 4xx/500 cho bản cũ.
    expect([200, 400, 422, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(JSON.parse(res.body).connected).toBe(false);
    }
  });
});

describe('XSS — Content-Type on JSON error responses', () => {
  it('error response sets application/json Content-Type, not text/html', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/export',
      headers: PAID_HEADERS,
      payload: { patientId: XSS_SCRIPT },
    });
    const ct = res.headers['content-type'] ?? '';
    expect(ct).toMatch(/application\/json/);
    expect(ct).not.toMatch(/text\/html/);
  });
});
