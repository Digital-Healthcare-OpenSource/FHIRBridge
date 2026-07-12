/**
 * Tests for requireScope() — RBAC-lite route guard.
 * Backward-compatible: permissive when the token carries no scopes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { requireScope, type AuthUser } from '../auth-plugin.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

async function buildApp(user: AuthUser): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  instance.decorateRequest('authUser', null);
  instance.addHook('onRequest', async (request) => {
    (request as unknown as { authUser: AuthUser }).authUser = user;
  });
  instance.get('/guarded', { preHandler: requireScope('export:write') }, async () => ({
    ok: true,
  }));
  await instance.ready();
  return instance;
}

describe('requireScope', () => {
  it('allows when the token carries NO scopes (permissive default)', async () => {
    app = await buildApp({ id: 'u1' });
    const res = await app.inject({ method: 'GET', url: '/guarded' });
    expect(res.statusCode).toBe(200);
  });

  it('allows when the required scope is present', async () => {
    app = await buildApp({ id: 'u1', scopes: ['export:write', 'export:read'] });
    const res = await app.inject({ method: 'GET', url: '/guarded' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when scopes are present but the required one is missing', async () => {
    app = await buildApp({ id: 'u1', scopes: ['export:read'] });
    const res = await app.inject({ method: 'GET', url: '/guarded' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ statusCode: 403, error: 'Forbidden' });
  });
});
