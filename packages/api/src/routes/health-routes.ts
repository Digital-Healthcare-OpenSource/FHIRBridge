/**
 * Health check route — GET /api/v1/health
 * Reports server status, version, and real component connectivity.
 * No authentication required.
 *
 * Accepts opts.postgresAuditSink and opts.redisStore for live probes.
 * Falls back to config URL presence check when sinks are absent (test mode).
 */

import { createRequire } from 'node:module';
import type { FastifyInstance } from 'fastify';
import type { ApiConfig } from '../config.js';
import type { PostgresAuditSink } from '../services/postgres-audit-sink.js';
import type { IRedisStore } from '../services/redis-store.js';

// Read version from package.json at import time (no hardcode)
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
const API_VERSION: string = (_require('../../package.json') as { version: string }).version;

const healthBodySchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    version: { type: 'string' },
    timestamp: { type: 'string' },
    checks: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
  },
} as const;

const healthSchema = {
  response: { 200: healthBodySchema },
} as const;

// Readiness trả 503 khi dependency đã cấu hình bị down — schema phải khai báo cả hai mã.
const readySchema = {
  response: { 200: healthBodySchema, 503: healthBodySchema },
} as const;

export interface HealthRoutesOpts {
  config: ApiConfig;
  /** Optional live Postgres sink — probed via isHealthy() */
  postgresAuditSink?: PostgresAuditSink;
  /** Optional live Redis store — probed via isHealthy() */
  redisStore?: IRedisStore;
}

type CheckState = 'ok' | 'error' | 'disabled';

/**
 * Probe every dependency. Distinguishes "not configured" (disabled — a supported self-host
 * posture) from "configured but down" (error — only this trips readiness).
 */
function computeChecks(opts: HealthRoutesOpts): Record<string, CheckState> {
  const checks: Record<string, CheckState> = { server: 'ok' };

  if (opts.postgresAuditSink) {
    checks['database'] = opts.postgresAuditSink.isHealthy() ? 'ok' : 'error';
  } else if (opts.config.databaseUrl) {
    checks['database'] = 'ok';
  } else {
    checks['database'] = 'disabled';
  }

  if (opts.redisStore) {
    checks['redis'] = opts.redisStore.isHealthy() ? 'ok' : 'error';
  } else if (opts.config.redisUrl) {
    checks['redis'] = 'ok';
  } else {
    checks['redis'] = 'disabled';
  }

  return checks;
}

export async function healthRoutes(
  fastify: FastifyInstance,
  opts: HealthRoutesOpts,
): Promise<void> {
  // Liveness: always 200 as long as the process can serve. Reports dep state for humans but a
  // down/disabled dep never fails liveness (that would make orchestrators kill a healthy process).
  fastify.get('/api/v1/health', { schema: healthSchema }, async (_request, reply) => {
    const checks = computeChecks(opts);
    const hasError = Object.values(checks).some((v) => v === 'error');
    return reply.status(200).send({
      status: hasError ? 'degraded' : 'ok',
      version: API_VERSION,
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  // Readiness: 503 when a CONFIGURED dependency is unhealthy, so a load balancer stops routing
  // traffic. Disabled (unconfigured) deps do NOT fail readiness.
  fastify.get('/api/v1/readyz', { schema: readySchema }, async (_request, reply) => {
    const checks = computeChecks(opts);
    const notReady = Object.values(checks).some((v) => v === 'error');
    return reply.status(notReady ? 503 : 200).send({
      status: notReady ? 'unavailable' : 'ready',
      version: API_VERSION,
      timestamp: new Date().toISOString(),
      checks,
    });
  });
}
