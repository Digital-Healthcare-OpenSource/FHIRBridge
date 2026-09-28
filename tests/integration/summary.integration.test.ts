/**
 * Integration tests — Summary routes.
 * Self-host edition: no quota / tier gating; any authenticated user can request a summary.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServer, userJwt, bearerHeader, MINIMAL_BUNDLE } from './helpers.js';

let server: FastifyInstance;

beforeAll(async () => {
  server = await createTestServer();
});

afterAll(async () => {
  await server.close();
});

describe('POST /api/v1/summary/generate', () => {
  it('authenticated user with valid bundle returns 202', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/summary/generate',
      headers: {
        authorization: bearerHeader(userJwt('summary-ok')),
        'content-type': 'application/json',
      },
      payload: { bundle: MINIMAL_BUNDLE },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.summaryId).toBeDefined();
    expect(typeof body.summaryId).toBe('string');
    expect(body.status).toBe('processing');
  });

  it('missing bundle field returns 400', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/summary/generate',
      headers: {
        authorization: bearerHeader(userJwt('summary-missing')),
        'content-type': 'application/json',
      },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('empty body returns 400 or 415', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/summary/generate',
      headers: {
        authorization: bearerHeader(userJwt('summary-empty')),
        'content-type': 'application/json',
      },
      payload: null,
    });
    expect([400, 415]).toContain(res.statusCode);
  });

  it('returns 401 without auth', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/summary/generate',
      headers: { 'content-type': 'application/json' },
      payload: { bundle: MINIMAL_BUNDLE },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/v1/summary/:id/download', () => {
  it('returns 404 for non-existent summary id', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/summary/00000000-0000-0000-0000-000000000000/download',
      headers: { authorization: bearerHeader(userJwt('summary-404')) },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 while processing, 200 when complete, or 502 once generation failed', async () => {
    const callerToken = userJwt('summary-processing');
    const postRes = await server.inject({
      method: 'POST',
      url: '/api/v1/summary/generate',
      headers: {
        authorization: bearerHeader(callerToken),
        'content-type': 'application/json',
      },
      payload: { bundle: MINIMAL_BUNDLE },
    });
    expect(postRes.statusCode).toBe(202);
    const { summaryId } = postRes.json();

    const downloadRes = await server.inject({
      method: 'GET',
      url: `/api/v1/summary/${summaryId}/download`,
      headers: { authorization: bearerHeader(callerToken) },
    });
    expect([200, 409, 502]).toContain(downloadRes.statusCode);
  });
});
