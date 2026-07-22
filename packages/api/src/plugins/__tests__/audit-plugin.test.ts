/**
 * Tests for audit plugin — onResponse hook, hashed user ID, no PHI.
 * Uses Fastify inject() — no network.
 */

import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { auditPlugin } from '../audit-plugin.js';
import type { AuditService, AuditPayload } from '../../services/audit-service.js';
import type { ApiConfig } from '../../config.js';

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

function buildMockAuditService() {
  const calls: AuditPayload[] = [];
  const service: AuditService = {
    log: vi.fn(async (payload: AuditPayload) => {
      calls.push(payload);
    }),
  } as unknown as AuditService;
  return { service, calls };
}

let app: FastifyInstance;
let auditCalls: AuditPayload[];
let mockService: AuditService;

beforeAll(async () => {
  const { service, calls } = buildMockAuditService();
  mockService = service;
  auditCalls = calls;

  app = Fastify({ logger: false });
  app.decorateRequest('authUser', null);

  await app.register(auditPlugin, { config: mockConfig, auditService: mockService });

  app.get('/api/v1/data', async () => ({ data: 'payload' }));
  app.get('/api/v1/health', async () => ({ status: 'ok' }));
  app.get('/api/v1/error', async (_req, reply) => {
    return reply.status(500).send({ error: 'server error' });
  });

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('Audit plugin — onResponse hook', () => {
  it('fires log after a successful request', async () => {
    const before = auditCalls.length;
    await app.inject({ method: 'GET', url: '/api/v1/data' });
    // Wait for async fire-and-forget
    await new Promise((r) => setTimeout(r, 10));
    expect(auditCalls.length).toBeGreaterThan(before);
  });

  it('sets status=success for 2xx responses', async () => {
    auditCalls.length = 0;
    await app.inject({ method: 'GET', url: '/api/v1/data' });
    await new Promise((r) => setTimeout(r, 10));
    const last = auditCalls[auditCalls.length - 1];
    expect(last?.status).toBe('success');
  });

  it('sets status=error for 4xx/5xx responses', async () => {
    auditCalls.length = 0;
    await app.inject({ method: 'GET', url: '/api/v1/error' });
    await new Promise((r) => setTimeout(r, 10));
    const last = auditCalls[auditCalls.length - 1];
    expect(last?.status).toBe('error');
  });
});

describe('Audit plugin — KR access log (접속기록, AUDIT_PROFILE=kr)', () => {
  let krApp: FastifyInstance;
  let krCalls: AuditPayload[];

  beforeAll(async () => {
    const { service, calls } = buildMockAuditService();
    krCalls = calls;
    krApp = Fastify({ logger: false });
    krApp.decorateRequest('authUser', null);
    await krApp.register(auditPlugin, {
      config: { ...mockConfig, auditProfile: 'kr' },
      auditService: service,
    });
    krApp.post('/api/v1/export', async () => ({ ok: true }));
    await krApp.ready();
  });

  afterAll(async () => {
    await krApp.close();
  });

  it('ghi patientRefHash (HMAC 16-hex) + sourceIp — KHÔNG BAO GIỜ raw patient id', async () => {
    krCalls.length = 0;
    await krApp.inject({
      method: 'POST',
      url: '/api/v1/export',
      payload: { patientId: 'patient-kr-001' },
    });
    await new Promise((r) => setTimeout(r, 10));

    const last = krCalls[krCalls.length - 1]!;
    const expectedHash = createHmac('sha256', mockConfig.hmacSecret)
      .update('patient-kr-001')
      .digest('hex')
      .slice(0, 16);
    expect(last.metadata).toMatchObject({ patientRefHash: expectedHash });
    expect(last.metadata?.['sourceIp']).toBeTruthy();
    // Zero-PHI invariant: raw patient id không xuất hiện ở bất kỳ đâu trong payload
    expect(JSON.stringify(last)).not.toContain('patient-kr-001');
  });

  it('request không có patientId → chỉ có sourceIp, không có patientRefHash', async () => {
    krCalls.length = 0;
    await krApp.inject({ method: 'POST', url: '/api/v1/export', payload: {} });
    await new Promise((r) => setTimeout(r, 10));

    const last = krCalls[krCalls.length - 1]!;
    expect(last.metadata?.['sourceIp']).toBeTruthy();
    expect(last.metadata).not.toHaveProperty('patientRefHash');
  });

  it('profile mặc định: metadata KHÔNG chứa sourceIp/patientRefHash (hành vi cũ giữ nguyên)', async () => {
    auditCalls.length = 0;
    await app.inject({ method: 'GET', url: '/api/v1/data' });
    await new Promise((r) => setTimeout(r, 10));

    const last = auditCalls[auditCalls.length - 1]!;
    expect(last.metadata).not.toHaveProperty('sourceIp');
    expect(last.metadata).not.toHaveProperty('patientRefHash');
  });
});

describe('Audit plugin — user ID hashing', () => {
  it('hashes anonymous user ID — does not log raw "anonymous"', async () => {
    auditCalls.length = 0;
    await app.inject({ method: 'GET', url: '/api/v1/data' });
    await new Promise((r) => setTimeout(r, 10));
    const last = auditCalls[auditCalls.length - 1];
    // userIdHash should be a 16-char hex string, not the raw userId
    expect(last?.userIdHash).not.toBe('anonymous');
    expect(last?.userIdHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('userIdHash length is exactly 16 hex chars', async () => {
    auditCalls.length = 0;
    await app.inject({ method: 'GET', url: '/api/v1/data' });
    await new Promise((r) => setTimeout(r, 10));
    const last = auditCalls[auditCalls.length - 1];
    expect(last?.userIdHash.length).toBe(16);
  });

  it('keys the HMAC with hmacSecret — NOT the JWT signing key (key separation)', async () => {
    auditCalls.length = 0;
    await app.inject({ method: 'GET', url: '/api/v1/data' });
    await new Promise((r) => setTimeout(r, 10));
    const last = auditCalls[auditCalls.length - 1];

    const withHmac = createHmac('sha256', mockConfig.hmacSecret)
      .update('anonymous')
      .digest('hex')
      .slice(0, 16);
    const withJwt = createHmac('sha256', mockConfig.jwtSecret)
      .update('anonymous')
      .digest('hex')
      .slice(0, 16);

    expect(last?.userIdHash).toBe(withHmac);
    expect(last?.userIdHash).not.toBe(withJwt);
  });
});

describe('Audit plugin — health route exclusion', () => {
  it('does NOT fire audit log for /api/v1/health', async () => {
    auditCalls.length = 0;
    await app.inject({ method: 'GET', url: '/api/v1/health' });
    await new Promise((r) => setTimeout(r, 10));
    expect(auditCalls.length).toBe(0);
  });
});

describe('Audit plugin — no PHI in log', () => {
  it('metadata contains path, method, statusCode — no patient data fields', async () => {
    auditCalls.length = 0;
    await app.inject({ method: 'GET', url: '/api/v1/data' });
    await new Promise((r) => setTimeout(r, 10));
    const last = auditCalls[auditCalls.length - 1];
    const meta = last?.metadata ?? {};
    expect(meta).toHaveProperty('method');
    expect(meta).toHaveProperty('statusCode');
    // Ensure no PHI-like fields
    expect(meta).not.toHaveProperty('patientId');
    expect(meta).not.toHaveProperty('name');
    expect(meta).not.toHaveProperty('dob');
  });
});
