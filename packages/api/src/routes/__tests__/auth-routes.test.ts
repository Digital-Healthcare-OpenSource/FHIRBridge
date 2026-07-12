/**
 * Tests for POST /api/v1/auth/logout — revokes the caller's jti and audits the sign-out.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { authRoutes } from '../auth-routes.js';
import { InMemoryJtiDenylist, type AuthUser } from '../../plugins/auth-plugin.js';
import type { AuditService, AuditPayload } from '../../services/audit-service.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

function buildAuditService() {
  const calls: AuditPayload[] = [];
  const service = {
    log: vi.fn(async (p: AuditPayload) => {
      calls.push(p);
    }),
  } as unknown as AuditService;
  return { service, calls };
}

async function buildApp(user: AuthUser, denylist = new InMemoryJtiDenylist()) {
  const { service, calls } = buildAuditService();
  const instance = Fastify({ logger: false });
  instance.decorateRequest('authUser', null);
  instance.addHook('onRequest', async (request) => {
    (request as unknown as { authUser: AuthUser }).authUser = user;
  });
  await instance.register(authRoutes, {
    auditService: service,
    hmacSecret: 'test-hmac-secret-key',
    jtiDenylist: denylist,
  });
  await instance.ready();
  return { instance, calls, denylist };
}

describe('POST /api/v1/auth/logout', () => {
  it('revokes the caller jti and returns 204', async () => {
    const built = await buildApp({
      id: 'user-1',
      jti: 'jti-abc',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    app = built.instance;

    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(res.statusCode).toBe(204);
    expect(await built.denylist.isRevoked('jti-abc')).toBe(true);
  });

  it('audits the sign-out with action=auth_logout and a hashed (non-raw) user id', async () => {
    const built = await buildApp({
      id: 'user-1',
      jti: 'jti-xyz',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    app = built.instance;

    await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    const last = built.calls[built.calls.length - 1];
    expect(last?.action).toBe('auth_logout');
    expect(last?.status).toBe('success');
    expect(last?.userIdHash).toMatch(/^[0-9a-f]{16}$/);
    expect(last?.userIdHash).not.toBe('user-1');
  });

  it('is audit-only (204) for callers without a jti (e.g. API-key auth)', async () => {
    const built = await buildApp({ id: 'apikey:deadbeefdeadbeef' });
    app = built.instance;

    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(res.statusCode).toBe(204);
    expect(built.calls[built.calls.length - 1]?.action).toBe('auth_logout');
  });
});
