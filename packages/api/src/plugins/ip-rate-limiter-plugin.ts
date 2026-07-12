/**
 * IP-based rate limiter — runs BEFORE the auth hook.
 *
 * The per-user rate limiter (rate-limiter-plugin) only sees requests that already passed auth,
 * and the auth hook short-circuits with 401. That means unauthenticated floods and API-key
 * brute-force attempts are never throttled by the per-user limiter. This plugin adds a coarse,
 * per-client-IP fixed-window counter that runs independently of auth so those flows ARE bounded.
 *
 * Scope: single-replica in-memory (consistent with the in-memory fallback posture elsewhere).
 * Budget defaults higher than the per-user budget so it only trips on genuine abuse.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { skipOverride } from './plugin-utils.js';

/** Default per-IP budget per window. Higher than per-user so it only catches floods. */
const DEFAULT_IP_MAX_PER_MINUTE = 300;
const WINDOW_MS = 60_000;

/** Probe endpoints that must never be throttled (k8s liveness/readiness). */
const ALLOW_LIST = new Set(['/api/v1/health', '/api/v1/readyz']);

export interface IpRateLimiterOptions {
  /** Max requests per IP per window. */
  maxPerMinute?: number;
  /** Window length in ms (default 60_000). */
  windowMs?: number;
}

interface WindowState {
  count: number;
  resetAt: number;
}

async function _ipRateLimiterPlugin(
  fastify: FastifyInstance,
  opts: IpRateLimiterOptions = {},
): Promise<void> {
  const max =
    opts.maxPerMinute && opts.maxPerMinute > 0 ? opts.maxPerMinute : DEFAULT_IP_MAX_PER_MINUTE;
  const windowMs = opts.windowMs && opts.windowMs > 0 ? opts.windowMs : WINDOW_MS;
  const buckets = new Map<string, WindowState>();

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0] ?? '';
    if (ALLOW_LIST.has(path)) return;

    const ip = request.ip;
    const now = Date.now();
    const existing = buckets.get(ip);
    const state: WindowState =
      !existing || now >= existing.resetAt ? { count: 0, resetAt: now + windowMs } : existing;

    state.count += 1;
    buckets.set(ip, state);

    if (state.count > max) {
      const retryAfter = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
      return reply
        .status(429)
        .header('retry-after', String(retryAfter))
        .send({
          statusCode: 429,
          error: 'Too Many Requests',
          message: `IP rate limit exceeded. Try again in ${retryAfter} seconds.`,
          retryAfter,
        });
    }
  });

  // Periodically drop expired buckets so the map stays bounded under many distinct IPs.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, state] of buckets) {
      if (now >= state.resetAt) buckets.delete(ip);
    }
  }, windowMs);
  sweep.unref();

  fastify.addHook('onClose', async () => {
    clearInterval(sweep);
  });
}

export const ipRateLimiterPlugin = skipOverride(_ipRateLimiterPlugin);
