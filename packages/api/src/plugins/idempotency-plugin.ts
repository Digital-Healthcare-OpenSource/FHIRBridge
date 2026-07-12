/**
 * Idempotency-Key plugin (H-11).
 *
 * Caches the first response body + status for a given (userId, method+path, Idempotency-Key)
 * tuple and replays it for retries within the TTL window. Prevents duplicate exports when
 * a client retries a POST because of a flaky network.
 *
 * Scope: only POST/PUT/PATCH with an `Idempotency-Key` header are considered.
 * Missing header → request proceeds normally (idempotency is opt-in).
 *
 * Storage: in-memory Map by default. For multi-replica deploys, wire a shared IIdempotencyStore.
 * This keeps the plugin PHI-safe — cached payloads never outlive the 10-min TTL.
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { skipOverride } from './plugin-utils.js';

export interface IdempotencyEntry {
  statusCode: number;
  body: string;
  contentType: string;
  createdAt: number;
}

export interface IIdempotencyStore {
  get(key: string): Promise<IdempotencyEntry | null>;
  set(key: string, entry: IdempotencyEntry, ttlMs: number): Promise<void>;
}

/** Simple in-memory TTL store. Clears expired entries lazily on access. */
export class InMemoryIdempotencyStore implements IIdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();

  async get(key: string): Promise<IdempotencyEntry | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    return entry;
  }

  async set(key: string, entry: IdempotencyEntry, ttlMs: number): Promise<void> {
    this.entries.set(key, entry);
    // Schedule cleanup — unref so it doesn't keep the event loop alive
    const timer = setTimeout(() => this.entries.delete(key), ttlMs);
    timer.unref();
  }

  /** Test helper: drop all entries. */
  clear(): void {
    this.entries.clear();
  }
}

export interface IdempotencyPluginOptions {
  store?: IIdempotencyStore;
  /** TTL in milliseconds. Default 10 minutes. */
  ttlMs?: number;
  /** Only apply to these HTTP methods. */
  methods?: readonly string[];
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_METHODS = ['POST', 'PUT', 'PATCH'] as const;

/** SHA-256 (16 hex) of the serialized request body — binds a cache entry to its payload. */
function hashBody(body: unknown): string {
  const serialized = body === undefined || body === null ? '' : JSON.stringify(body);
  return createHash('sha256').update(serialized, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Build the idempotency cache key.
 *
 * C4: key on `authUser.id` (auth sets `id`, never `userId`). A missing/empty id makes the
 * request UN-CACHEABLE (returns null) — we must NOT collapse every unauthenticated caller into a
 * shared 'anonymous' bucket, which would let one tenant replay another tenant's cached PHI.
 * The body hash ensures a reused Idempotency-Key with a *different* payload cannot replay a stale
 * response.
 */
function keyFor(request: FastifyRequest, idempotencyKey: string): string | null {
  const userId = request.authUser?.id;
  if (!userId) return null;
  const path = request.routeOptions?.url ?? request.url;
  return `${userId}:${request.method}:${path}:${idempotencyKey}:${hashBody(request.body)}`;
}

async function _idempotencyPlugin(
  fastify: FastifyInstance,
  opts: IdempotencyPluginOptions = {},
): Promise<void> {
  const store = opts.store ?? new InMemoryIdempotencyStore();
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const methods = (opts.methods ?? DEFAULT_METHODS).map((m) => m.toUpperCase());

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!methods.includes(request.method.toUpperCase())) return;

    const headerValue = request.headers['idempotency-key'];
    if (!headerValue || typeof headerValue !== 'string' || headerValue.length === 0) return;

    const key = keyFor(request, headerValue);
    if (!key) return; // un-cacheable (no authenticated identity) — never share a bucket

    const cached = await store.get(key);
    if (cached) {
      reply
        .status(cached.statusCode)
        .header('content-type', cached.contentType)
        .header('idempotent-replay', 'true')
        .send(cached.body);
    }
  });

  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
    if (!methods.includes(request.method.toUpperCase())) return payload;

    const headerValue = request.headers['idempotency-key'];
    if (!headerValue || typeof headerValue !== 'string' || headerValue.length === 0) return payload;

    if (reply.getHeader('idempotent-replay') === 'true') return payload;

    const status = reply.statusCode;
    if (status < 200 || status >= 300) return payload;

    const key = keyFor(request, headerValue);
    if (!key) return payload; // un-cacheable (no authenticated identity)

    const body =
      typeof payload === 'string'
        ? payload
        : Buffer.isBuffer(payload)
          ? payload.toString('utf8')
          : JSON.stringify(payload);

    await store.set(
      key,
      {
        statusCode: status,
        body,
        contentType: String(reply.getHeader('content-type') ?? 'application/json'),
        createdAt: Date.now(),
      },
      ttlMs,
    );

    return payload;
  });
}

export const idempotencyPlugin = skipOverride(_idempotencyPlugin);
