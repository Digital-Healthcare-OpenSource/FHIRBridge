/**
 * Tests bảo mật H-1: constant-time API key comparison.
 * Kiểm tra:
 * - Valid key vẫn authenticate được
 * - Invalid key bị reject
 * - User ID dùng SHA-256 hash prefix thay vì raw key prefix
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { authPlugin } from '../auth-plugin.js';
import type { ApiConfig } from '../../config.js';

const VALID_API_KEY = 'super-secret-api-key-for-timing-test';
const ANOTHER_VALID_KEY = 'another-valid-key-abcdefgh';

const mockConfig: ApiConfig = {
  port: 3001,
  host: '0.0.0.0',
  jwtSecret: 'jwt-secret-timing-test',
  hmacSecret: 'hmac-secret',
  apiKeys: [VALID_API_KEY, ANOTHER_VALID_KEY],
  corsOrigins: ['http://localhost:3000'],
  logLevel: 'silent',
  rateLimitPerMinute: 100,
  enableDocs: true,
  auditRetentionDays: 90,
};

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(authPlugin, { config: mockConfig });
  app.get('/api/v1/protected', async (req, reply) => reply.send({ user: req.authUser }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('Auth plugin H-1 — constant-time API key', () => {
  it('accepts first valid key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { 'X-API-Key': VALID_API_KEY },
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts second valid key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { 'X-API-Key': ANOTHER_VALID_KEY },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects key with one byte difference', async () => {
    // Thay ký tự cuối — đảm bảo không có short-circuit trên prefix
    const almostValid = VALID_API_KEY.slice(0, -1) + 'X';
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { 'X-API-Key': almostValid },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects empty string key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { 'X-API-Key': '' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('user ID uses SHA-256 hash prefix, not raw key prefix', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { 'X-API-Key': VALID_API_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: { id: string } };

    // Tính SHA-256 expected
    const expectedHash = createHash('sha256')
      .update(VALID_API_KEY, 'utf8')
      .digest('hex')
      .slice(0, 16);

    expect(body.user.id).toBe(`apikey:${expectedHash}`);
    // Đảm bảo không dùng raw prefix (8 chars đầu của key)
    expect(body.user.id).not.toContain(VALID_API_KEY.slice(0, 8));
  });

  it('two different keys produce different user IDs', async () => {
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { 'X-API-Key': VALID_API_KEY },
    });
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { 'X-API-Key': ANOTHER_VALID_KEY },
    });
    const id1 = (res1.json() as { user: { id: string } }).user.id;
    const id2 = (res2.json() as { user: { id: string } }).user.id;
    expect(id1).not.toBe(id2);
  });
});
