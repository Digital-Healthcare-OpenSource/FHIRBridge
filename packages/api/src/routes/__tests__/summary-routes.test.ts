/**
 * Tests for summary routes:
 *   POST /api/v1/summary/generate
 *   GET  /api/v1/summary/:id/download
 *
 * Uses Fastify inject() with mocked SummaryService.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AuthUser } from '../auth-plugin.js';
import type { ApiConfig } from '../../config.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockStartGeneration = vi.fn().mockResolvedValue('summary-id-abc');
const mockGetSummaryStatus = vi.fn();

vi.mock('../../services/summary-service.js', () => ({
  SummaryService: vi.fn().mockImplementation(() => ({
    startGeneration: mockStartGeneration,
    getStatus: mockGetSummaryStatus,
  })),
}));

const { summaryRoutes } = await import('../summary-routes.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockConfig: ApiConfig = {
  port: 3001,
  host: '0.0.0.0',
  jwtSecret: 'test-secret',
  hmacSecret: 'test-hmac',
  apiKeys: [],
  corsOrigins: ['*'],
  logLevel: 'silent',
  rateLimitPerMinute: 100,
  enableDocs: true,
  auditRetentionDays: 90,
};

const validBundle = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [],
};

async function buildApp(user: AuthUser | null = { id: 'user-1' }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => {
    (request as unknown as { authUser: AuthUser | null }).authUser = user;
  });
  await app.register(summaryRoutes, { config: mockConfig });
  await app.ready();
  return app;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockStartGeneration.mockResolvedValue('summary-id-abc');
});

// ── POST /api/v1/summary/generate ────────────────────────────────────────────

describe('POST /api/v1/summary/generate', () => {
  it('returns 202 with summaryId on success', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/generate',
      payload: { bundle: validBundle },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.summaryId).toBe('summary-id-abc');
    expect(body.status).toBe('processing');
  });

  it('returns 400 when bundle is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/generate',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── GET /api/v1/summary/:id/download ────────────────────────────────────────

describe('GET /api/v1/summary/:id/download', () => {
  const mockSummary = { resourceType: 'Composition', id: 's1' };

  it('returns text/markdown for default format', async () => {
    mockGetSummaryStatus.mockResolvedValueOnce({
      status: 'complete',
      summary: mockSummary,
      formattedMarkdown: '# Patient Summary',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/summary-id-abc/download',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    expect(res.body).toBe('# Patient Summary');
  });

  it('returns application/fhir+json for composition format', async () => {
    mockGetSummaryStatus.mockResolvedValueOnce({
      status: 'complete',
      summary: mockSummary,
      formattedMarkdown: '# summary',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/summary-id-abc/download?format=composition',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/fhir\+json/);
  });

  it('returns 404 when summary not found', async () => {
    mockGetSummaryStatus.mockResolvedValueOnce(undefined);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/missing/download',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when summary is still processing', async () => {
    mockGetSummaryStatus.mockResolvedValueOnce({ status: 'processing' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/summary-id-abc/download',
    });
    expect(res.statusCode).toBe(409);
  });
});
