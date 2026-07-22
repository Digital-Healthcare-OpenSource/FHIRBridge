/**
 * Integration — POST /api/v1/consent/record với yêu cầu PIPA Art. 28-8 (KR).
 * Grant market='kr' phải ack đủ 5 mục disclosure; thiếu bất kỳ mục nào → 400.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServer, userJwt, bearerHeader } from './helpers.js';

let server: FastifyInstance;

beforeAll(async () => {
  server = await createTestServer();
});

afterAll(async () => {
  await server.close();
});

const FULL_DISCLOSURES = {
  dataCategories: true,
  destinationAndMethod: true,
  recipientContact: true,
  purposeAndRetention: true,
  refusalAndConsequences: true,
};

function postConsent(body: Record<string, unknown>) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/consent/record',
    headers: {
      authorization: bearerHeader(userJwt('pipa-user')),
      'content-type': 'application/json',
    },
    payload: body,
  });
}

describe('POST /api/v1/consent/record — PIPA Art. 28-8', () => {
  it('KR grant với đủ 5 mục disclosure → 204', async () => {
    const res = await postConsent({
      type: 'crossborder_ai',
      consentVersionHash: 'v2-test',
      granted: true,
      market: 'kr',
      disclosures: FULL_DISCLOSURES,
    });
    expect(res.statusCode).toBe(204);
  });

  it.each(Object.keys(FULL_DISCLOSURES))('KR grant thiếu mục "%s" → 400', async (missingKey) => {
    const disclosures: Record<string, boolean> = { ...FULL_DISCLOSURES };
    delete disclosures[missingKey];

    const res = await postConsent({
      type: 'crossborder_ai',
      consentVersionHash: 'v2-test',
      granted: true,
      market: 'kr',
      disclosures,
    });
    expect(res.statusCode).toBe(400);
  });

  it('KR grant với một mục = false → 400 (phải ack thật, không chỉ có key)', async () => {
    const res = await postConsent({
      type: 'crossborder_ai',
      consentVersionHash: 'v2-test',
      granted: true,
      market: 'kr',
      disclosures: { ...FULL_DISCLOSURES, refusalAndConsequences: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it('KR grant KHÔNG có disclosures → 400', async () => {
    const res = await postConsent({
      type: 'crossborder_ai',
      consentVersionHash: 'v2-test',
      granted: true,
      market: 'kr',
    });
    expect(res.statusCode).toBe(400);
  });

  it('KR decline (granted=false) không cần disclosures → 204', async () => {
    const res = await postConsent({
      type: 'crossborder_ai',
      consentVersionHash: 'v2-test',
      granted: false,
      market: 'kr',
    });
    expect(res.statusCode).toBe(204);
  });

  it('non-KR grant không cần disclosures (backward compatible) → 204', async () => {
    const res = await postConsent({
      type: 'crossborder_ai',
      consentVersionHash: 'v2-test',
      granted: true,
    });
    expect(res.statusCode).toBe(204);
  });
});
