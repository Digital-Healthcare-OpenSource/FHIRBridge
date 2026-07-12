/**
 * Tests for the IP-based rate limiter — throttles UNAUTHENTICATED floods.
 * Runs before auth, so it must trip even when no authUser is ever attached.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ipRateLimiterPlugin } from '../ip-rate-limiter-plugin.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

async function buildApp(maxPerMinute: number): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  // NOTE: no auth hook — simulates unauthenticated traffic.
  await instance.register(ipRateLimiterPlugin, { maxPerMinute });
  instance.get('/api/v1/data', async () => ({ ok: true }));
  instance.get('/api/v1/health', async () => ({ status: 'ok' }));
  instance.get('/api/v1/readyz', async () => ({ status: 'ready' }));
  await instance.ready();
  return instance;
}

describe('IP rate limiter — unauthenticated flood', () => {
  it('returns 429 once an unauthenticated IP exceeds the budget', async () => {
    app = await buildApp(5);
    let last = 200;
    for (let i = 0; i < 12; i++) {
      const r = await app.inject({ method: 'GET', url: '/api/v1/data' });
      last = r.statusCode;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  it('sets a retry-after header on 429', async () => {
    app = await buildApp(2);
    let res = await app.inject({ method: 'GET', url: '/api/v1/data' });
    while (res.statusCode !== 429) {
      res = await app.inject({ method: 'GET', url: '/api/v1/data' });
    }
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.json()).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
  });

  it('never throttles liveness/readiness probes', async () => {
    app = await buildApp(2);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        app!.inject({ method: 'GET', url: i % 2 ? '/api/v1/health' : '/api/v1/readyz' }),
      ),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
  });
});
