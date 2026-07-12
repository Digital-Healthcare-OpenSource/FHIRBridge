/**
 * Audit plugin — logs every request/response cycle with hashed user ID.
 * PHI-free: only metadata (path, status, duration, hashed user) is recorded.
 * Uses onResponse hook so it never blocks the response path.
 * Interface is pluggable: swap consoleAuditSink for a Postgres sink later.
 */

import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuditService } from '../services/audit-service.js';
import type { ApiConfig } from '../config.js';
import { skipOverride } from './plugin-utils.js';

async function _auditPlugin(
  fastify: FastifyInstance,
  opts: { config: ApiConfig; auditService: AuditService },
): Promise<void> {
  const { config, auditService } = opts;

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0];
    if (path === '/api/v1/health' || path === '/api/v1/readyz') return;

    const userId = request.authUser?.id ?? 'anonymous';
    // Key separation: hash user IDs with HMAC_SECRET, never the JWT signing key.
    const userIdHash = createHmac('sha256', config.hmacSecret)
      .update(userId)
      .digest('hex')
      .slice(0, 16);

    const durationMs = Math.round(reply.elapsedTime);

    auditService
      .log({
        userIdHash,
        action: request.url,
        status: reply.statusCode >= 400 ? 'error' : 'success',
        metadata: {
          method: request.method,
          path: request.routeOptions?.url ?? request.url,
          statusCode: reply.statusCode,
          durationMs,
          requestId: (request as FastifyRequest & { id?: string }).id,
        },
      })
      .catch(() => {
        // Swallow audit errors — never break the API
      });
  });
}

export const auditPlugin = skipOverride(_auditPlugin);
