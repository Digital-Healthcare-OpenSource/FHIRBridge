/**
 * Tests for idempotency-plugin (H-11).
 * Uses InMemoryIdempotencyStore + fastify.inject() — no network.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { idempotencyPlugin, InMemoryIdempotencyStore } from '../idempotency-plugin.js';

let app: FastifyInstance;
let store: InMemoryIdempotencyStore;

function attachAuthUser(userId: string) {
  return async (request: { authUser?: { id: string } }) => {
    request.authUser = { id: userId };
  };
}

beforeEach(async () => {
  app = Fastify({ logger: false });
  store = new InMemoryIdempotencyStore();

  app.addHook('onRequest', attachAuthUser('user-1'));
  await app.register(idempotencyPlugin, { store, ttlMs: 60_000 });

  let counter = 0;
  app.post('/echo', async () => {
    counter += 1;
    return { counter };
  });

  app.post('/echo-body', async (req) => {
    counter += 1;
    return { counter, body: req.body };
  });

  app.post('/fail', async (_req, reply) => {
    return reply.status(500).send({ error: 'boom' });
  });

  app.get('/echo-get', async () => ({ n: 1 }));

  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('Idempotency plugin', () => {
  it('no Idempotency-Key → passes through, no dedup', async () => {
    const a = await app.inject({ method: 'POST', url: '/echo', payload: {} });
    const b = await app.inject({ method: 'POST', url: '/echo', payload: {} });
    expect(a.json().counter).toBe(1);
    expect(b.json().counter).toBe(2);
  });

  it('replays cached response for same Idempotency-Key', async () => {
    const headers = { 'idempotency-key': 'req-abc' };
    const first = await app.inject({ method: 'POST', url: '/echo', payload: {}, headers });
    const second = await app.inject({ method: 'POST', url: '/echo', payload: {}, headers });
    expect(first.json().counter).toBe(1);
    expect(second.json().counter).toBe(1);
    expect(second.headers['idempotent-replay']).toBe('true');
  });

  it('different Idempotency-Key → fresh execution', async () => {
    const a = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: {},
      headers: { 'idempotency-key': 'key-1' },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: {},
      headers: { 'idempotency-key': 'key-2' },
    });
    expect(a.json().counter).toBe(1);
    expect(b.json().counter).toBe(2);
  });

  it('non-2xx responses are NOT cached', async () => {
    const headers = { 'idempotency-key': 'fail-1' };
    const a = await app.inject({ method: 'POST', url: '/fail', payload: {}, headers });
    const b = await app.inject({ method: 'POST', url: '/fail', payload: {}, headers });
    expect(a.statusCode).toBe(500);
    expect(b.statusCode).toBe(500);
    expect(b.headers['idempotent-replay']).toBeUndefined();
  });

  it('GET ignored — no cache, no replay', async () => {
    const headers = { 'idempotency-key': 'get-1' };
    const a = await app.inject({ method: 'GET', url: '/echo-get', headers });
    const b = await app.inject({ method: 'GET', url: '/echo-get', headers });
    expect(a.statusCode).toBe(200);
    expect(b.headers['idempotent-replay']).toBeUndefined();
  });

  it('same key + SAME body → replayed (keyed per user + body-hash)', async () => {
    const headers = { 'idempotency-key': 'body-key' };
    const payload = { patientId: 'p-1' };
    const first = await app.inject({ method: 'POST', url: '/echo-body', payload, headers });
    const second = await app.inject({ method: 'POST', url: '/echo-body', payload, headers });
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json().counter).toBe(first.json().counter);
  });

  it('same key but DIFFERENT body → NOT replayed (body-hash guard)', async () => {
    const headers = { 'idempotency-key': 'reused-key' };
    const first = await app.inject({
      method: 'POST',
      url: '/echo-body',
      payload: { patientId: 'p-1' },
      headers,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/echo-body',
      payload: { patientId: 'p-2' },
      headers,
    });
    expect(second.headers['idempotent-replay']).toBeUndefined();
    expect(second.json().counter).not.toBe(first.json().counter);
    expect(second.json().body).toEqual({ patientId: 'p-2' });
  });

  it('no authenticated identity → un-cacheable (never shares an anonymous bucket)', async () => {
    const anon = Fastify({ logger: false });
    const shared = new InMemoryIdempotencyStore();
    // No authUser hook → request.authUser is undefined.
    await anon.register(idempotencyPlugin, { store: shared, ttlMs: 60_000 });
    let n = 0;
    anon.post('/echo', async () => ({ n: ++n }));
    await anon.ready();

    const headers = { 'idempotency-key': 'anon-key' };
    const a = await anon.inject({ method: 'POST', url: '/echo', payload: {}, headers });
    const b = await anon.inject({ method: 'POST', url: '/echo', payload: {}, headers });
    // Both execute fresh — no cross-request replay for unauthenticated callers.
    expect(a.json().n).toBe(1);
    expect(b.json().n).toBe(2);
    expect(b.headers['idempotent-replay']).toBeUndefined();
    await anon.close();
  });

  it('same key under different user → not shared', async () => {
    const app2 = Fastify({ logger: false });
    const shared = new InMemoryIdempotencyStore();
    app2.addHook('onRequest', attachAuthUser('user-2'));
    await app2.register(idempotencyPlugin, { store: shared, ttlMs: 60_000 });
    app2.post('/echo', async () => ({ who: 'user-2' }));
    await app2.ready();

    const appA = Fastify({ logger: false });
    appA.addHook('onRequest', attachAuthUser('user-1'));
    await appA.register(idempotencyPlugin, { store: shared, ttlMs: 60_000 });
    appA.post('/echo', async () => ({ who: 'user-1' }));
    await appA.ready();

    const headers = { 'idempotency-key': 'shared-key' };
    const r1 = await appA.inject({ method: 'POST', url: '/echo', payload: {}, headers });
    const r2 = await app2.inject({ method: 'POST', url: '/echo', payload: {}, headers });
    expect(r1.json().who).toBe('user-1');
    expect(r2.json().who).toBe('user-2');
    await app2.close();
    await appA.close();
  });
});
