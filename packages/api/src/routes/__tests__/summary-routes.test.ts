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
  summaryAiSettings: vi.fn(() => ({})),
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
  anthropicApiKey: 'sk-ant-test-not-real',
};

const validBundle = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [],
};

const mockGetExportStatus = vi.fn();

async function buildApp(
  user: AuthUser | null = { id: 'user-1' },
  config: ApiConfig = mockConfig,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => {
    (request as unknown as { authUser: AuthUser | null }).authUser = user;
  });
  await app.register(summaryRoutes, {
    config,
    exportService: { getStatus: mockGetExportStatus },
  });
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

  it('returns 400 when neither bundle nor exportId is given', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/generate',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/bundle or exportId/);
  });

  it('fails fast with 503 naming the env var when the provider key is not configured', async () => {
    const noKeyApp = await buildApp(
      { id: 'user-1' },
      { ...mockConfig, anthropicApiKey: undefined },
    );
    try {
      const res = await noKeyApp.inject({
        method: 'POST',
        url: '/api/v1/summary/generate',
        payload: { bundle: validBundle },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().message).toMatch(/ANTHROPIC_API_KEY/);
      expect(mockStartGeneration).not.toHaveBeenCalled();
    } finally {
      await noKeyApp.close();
    }
  });

  it('uses AI_PROVIDER=openai as the default provider', async () => {
    const openaiApp = await buildApp(
      { id: 'user-1' },
      { ...mockConfig, aiProvider: 'openai', openaiApiKey: 'sk-test-not-real' },
    );
    try {
      const res = await openaiApp.inject({
        method: 'POST',
        url: '/api/v1/summary/generate',
        payload: { bundle: validBundle },
      });
      expect(res.statusCode).toBe(202);
      expect(mockStartGeneration.mock.calls[0][0].summaryConfig.provider).toBe('openai');
    } finally {
      await openaiApp.close();
    }
  });

  it('summarises a finished export by exportId (web UI flow)', async () => {
    mockGetExportStatus.mockResolvedValueOnce({
      status: 'complete',
      userId: 'user-1',
      bundle: validBundle,
      createdAt: Date.now(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/generate',
      payload: { exportId: 'export-1', summaryConfig: { language: 'vi', provider: 'claude' } },
    });
    expect(res.statusCode).toBe(202);
    expect(mockGetExportStatus).toHaveBeenCalledWith('export-1', 'user-1');
    const request = mockStartGeneration.mock.calls[0][0];
    expect(request.bundle).toEqual(validBundle);
    expect(request.summaryConfig).toMatchObject({ language: 'vi', provider: 'claude' });
  });

  it('returns 404 for an export the caller does not own (or that expired)', async () => {
    mockGetExportStatus.mockResolvedValueOnce(undefined);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/generate',
      payload: { exportId: 'someone-elses-export' },
    });
    expect(res.statusCode).toBe(404);
    expect(mockStartGeneration).not.toHaveBeenCalled();
  });

  it('returns 409 while the export is still processing', async () => {
    mockGetExportStatus.mockResolvedValueOnce({
      status: 'processing',
      userId: 'user-1',
      createdAt: Date.now(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/generate',
      payload: { exportId: 'export-1' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects language names — only en|vi|ja|ko codes are accepted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/generate',
      payload: { bundle: validBundle, summaryConfig: { language: 'English' } },
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

  it('returns 502 with the reason when generation failed (clients must stop polling)', async () => {
    mockGetSummaryStatus.mockResolvedValueOnce({ status: 'failed', error: 'provider timeout' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/summary-id-abc/download',
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toMatch(/provider timeout/);
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
