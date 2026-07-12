/**
 * Rate limiter plugin — sliding window rate limiting per authenticated user (or IP).
 * Defaults to 100 requests/min — protects against runaway clients without limiting hospital ops.
 * Uses Redis for distributed rate limiting when redisUrl is configured; falls back in-memory.
 */

import fastifyRateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { skipOverride } from './plugin-utils.js';

/** Default request budget per minute. Override via RATE_LIMIT_PER_MINUTE env if needed. */
const DEFAULT_RATE_LIMIT_PER_MINUTE = 100;

interface RateLimiterOptions {
  redisUrl?: string;
  /** Optional override for the per-minute budget (used by tests / deployments needing tighter caps). */
  maxPerMinute?: number;
}

async function _rateLimiterPlugin(
  fastify: FastifyInstance,
  opts: RateLimiterOptions,
): Promise<void> {
  let redisClient: Redis | undefined;

  if (opts.redisUrl) {
    try {
      redisClient = new Redis(opts.redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
      });
      redisClient.on('error', (err: Error) => {
        fastify.log.warn(
          { err: err.message },
          '[RateLimiter] Redis error, falling back to in-memory',
        );
      });
      await redisClient.connect();
      fastify.log.info('[RateLimiter] connected to Redis for distributed rate limiting');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.warn(`[RateLimiter] Redis connect failed (${msg}), using in-memory store`);
      redisClient = undefined;
    }
  }

  const envBudget = Number(process.env['RATE_LIMIT_PER_MINUTE']);
  const maxPerMinute =
    opts.maxPerMinute ??
    (Number.isFinite(envBudget) && envBudget > 0 ? envBudget : DEFAULT_RATE_LIMIT_PER_MINUTE);

  await fastify.register(fastifyRateLimit, {
    global: true,
    redis: redisClient,
    max: maxPerMinute,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => req.authUser?.id ?? req.ip,
    allowList: (req: FastifyRequest) => {
      const path = req.url.split('?')[0];
      return path === '/api/v1/health' || path === '/api/v1/readyz';
    },
    errorResponseBuilder: (req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      retryAfter: Math.ceil(context.ttl / 1000),
      requestId: (req as FastifyRequest & { id?: string }).id,
    }),
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  if (redisClient) {
    const client = redisClient;
    fastify.addHook('onClose', async () => {
      await client.quit().catch(() => client.disconnect());
    });
  }
}

export const rateLimiterPlugin = skipOverride(_rateLimiterPlugin);
