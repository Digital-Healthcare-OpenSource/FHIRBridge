/**
 * Auth routes:
 *   POST /api/v1/auth/logout — revoke the caller's JWT `jti` (if present) and audit the sign-out.
 *
 * Auth required (via authPlugin). Revocation is best-effort: API-key callers and JWTs minted
 * without a `jti` have nothing to revoke, but the sign-out is still audited (action=auth_logout).
 * The jti is denylisted until the token's own `exp`, so a revoked token is rejected for the rest
 * of its lifetime and no longer than necessary.
 */

import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuditService } from '../services/audit-service.js';
import type { IJtiDenylist } from '../plugins/auth-plugin.js';

export interface AuthRoutesOpts {
  auditService: AuditService;
  /** HMAC key for hashing user IDs in the audit log (key-separated from JWT secret). */
  hmacSecret: string;
  /** Optional revocation list — when absent, logout is audit-only. */
  jtiDenylist?: IJtiDenylist;
}

/** Same 16-hex truncation policy as the audit plugin. */
function hashUserId(userId: string, hmacSecret: string): string {
  return createHmac('sha256', hmacSecret).update(userId).digest('hex').slice(0, 16);
}

export async function authRoutes(fastify: FastifyInstance, opts: AuthRoutesOpts): Promise<void> {
  fastify.post('/api/v1/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const authUser = request.authUser;
    // authPlugin guarantees authUser is set (route is not public).
    const userId = authUser?.id ?? 'anonymous';

    // Revoke the jti until its own expiry, if both are available.
    if (authUser?.jti && opts.jtiDenylist) {
      const nowSec = Math.floor(Date.now() / 1000);
      const ttlSeconds = authUser.exp ? Math.max(1, authUser.exp - nowSec) : 3600;
      await opts.jtiDenylist.revoke(authUser.jti, ttlSeconds);
    }

    await opts.auditService
      .log({
        userIdHash: hashUserId(userId, opts.hmacSecret),
        action: 'auth_logout',
        status: 'success',
        metadata: { requestId: (request as FastifyRequest & { id?: string }).id },
      })
      .catch(() => {
        // Never fail logout on an audit error.
      });

    return reply.status(204).send();
  });
}
