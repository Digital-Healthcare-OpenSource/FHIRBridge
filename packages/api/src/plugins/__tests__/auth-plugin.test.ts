/**
 * Tests for auth plugin — JWT + API key authentication.
 * Uses Fastify inject() — no network.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { authPlugin, InMemoryJtiDenylist } from '../auth-plugin.js';
import type { ApiConfig } from '../../config.js';

const JWT_SECRET = 'test-super-secret-for-unit-tests';
const VALID_API_KEY = 'valid-test-api-key-123';

const mockConfig: ApiConfig = {
  port: 3001,
  host: '0.0.0.0',
  jwtSecret: JWT_SECRET,
  hmacSecret: JWT_SECRET,
  apiKeys: [VALID_API_KEY],
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

  // Protected test route
  app.get('/api/v1/protected', async (req, reply) => {
    return reply.send({ user: req.authUser });
  });

  // Simulated health route (public)
  app.get('/api/v1/health', async (_req, reply) => {
    return reply.send({ status: 'ok' });
  });

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('Auth plugin — API key', () => {
  it('allows requests with valid API key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { 'X-API-Key': VALID_API_KEY },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user).toBeDefined();
    expect(body.user.id).toMatch(/^apikey:[0-9a-f]{16}$/);
  });

  it('rejects requests with invalid API key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { 'X-API-Key': 'wrong-key' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('Auth plugin — JWT', () => {
  it('allows requests with valid JWT (with exp + sub)', async () => {
    const token = app.jwt.sign({ sub: 'user-123' }, { expiresIn: '1h' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.id).toBe('user-123');
  });

  it('rejects requests with invalid JWT', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a JWT with no exp claim (requiredClaims: exp)', async () => {
    // Default sign() adds no exp.
    const token = app.jwt.sign({ sub: 'user-123' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a JWT with no sub claim — never falls back to id="unknown"', async () => {
    const token = app.jwt.sign({ role: 'clinician' }, { expiresIn: '1h' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
    expect(JSON.stringify(response.json())).not.toContain('unknown');
  });

  it('rejects a JWT whose sub is an empty string (identity collapse guard)', async () => {
    const token = app.jwt.sign({ sub: '' }, { expiresIn: '1h' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('Auth plugin — jti revocation (logout denylist)', () => {
  it('rejects a token whose jti has been revoked', async () => {
    const denylist = new InMemoryJtiDenylist();
    const app2 = Fastify({ logger: false });
    await app2.register(authPlugin, { config: mockConfig, jtiDenylist: denylist });
    app2.get('/api/v1/protected', async (req, reply) => reply.send({ user: req.authUser }));
    await app2.ready();

    const token = app2.jwt.sign({ sub: 'user-x', jti: 'jti-1' }, { expiresIn: '1h' });

    const ok = await app2.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);

    await denylist.revoke('jti-1', 3600);

    const revoked = await app2.inject({
      method: 'GET',
      url: '/api/v1/protected',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(revoked.statusCode).toBe(401);
    await app2.close();
  });
});

describe('Auth plugin — public routes', () => {
  it('allows health endpoint without auth', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
  });
});

describe('Auth plugin — missing auth', () => {
  it('returns 401 for requests without any credentials', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/protected' });
    expect(response.statusCode).toBe(401);
  });
});
