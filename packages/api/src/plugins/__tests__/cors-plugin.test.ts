/**
 * Tests for CORS plugin — validates origin/credentials configuration.
 * Uses Fastify inject() — no network.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { corsPlugin } from '../cors-plugin.js';
import type { ApiConfig } from '../../config.js';

const baseConfig: ApiConfig = {
  port: 3001,
  host: '0.0.0.0',
  jwtSecret: 'test-secret',
  hmacSecret: 'test-hmac',
  apiKeys: [],
  corsOrigins: ['http://localhost:3000'],
  logLevel: 'silent',
  rateLimitPerMinute: 100,
  enableDocs: true,
  auditRetentionDays: 90,
};

async function buildApp(corsOrigins: string[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(corsPlugin, { config: { ...baseConfig, corsOrigins } });
  app.get('/test', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('CORS plugin — wildcard origin', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(['*']);
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds with wildcard Access-Control-Allow-Origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { origin: 'http://evil.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('does NOT set Access-Control-Allow-Credentials when origin is wildcard', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { origin: 'http://evil.com' },
    });
    // credentials header must be absent or not "true" with wildcard
    expect(res.headers['access-control-allow-credentials']).not.toBe('true');
  });

  it('handles OPTIONS preflight with wildcard', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/test',
      headers: {
        origin: 'http://evil.com',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('CORS plugin — specific origins list', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(['http://localhost:3000', 'https://app.example.com']);
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows listed origin and sets credentials header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('allows second listed origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { origin: 'https://app.example.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
  });

  it('preflight OPTIONS returns 204 for allowed origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/test',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'Content-Type,Authorization',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-methods']).toMatch(/POST/);
  });
});
