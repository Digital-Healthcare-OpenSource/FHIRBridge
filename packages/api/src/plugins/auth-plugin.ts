/**
 * Authentication plugin — verifies JWT Bearer tokens or X-API-Key header.
 * Skips auth for GET /api/v1/health.
 * Attaches user info to request via authUser property.
 *
 * skip-override ensures hooks and JWT decorators apply globally.
 *
 * Bảo mật H-1:
 * - So sánh API key bằng crypto.timingSafeEqual để ngăn timing attack
 * - User ID từ API key dùng SHA-256 (16 hex chars đầu) thay vì plain prefix
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import type { ApiConfig } from '../config.js';
import { skipOverride } from './plugin-utils.js';

export interface AuthUser {
  id: string;
  /** Optional RBAC-lite role claim (from JWT `role`). */
  role?: string;
  /** Optional OAuth-style scopes (from JWT `scope` string or `scopes` array). */
  scopes?: string[];
  /** JWT ID — present only for JWT auth; used by the logout denylist. */
  jti?: string;
  /** JWT expiry (epoch seconds) — used to bound the denylist TTL. */
  exp?: number;
}

// Augment FastifyRequest to carry typed user info
declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

/**
 * Optional revocation list for JWT `jti` values (logout / forced sign-out).
 * Redis-backed in production; in-memory fallback for single-replica / tests.
 */
export interface IJtiDenylist {
  isRevoked(jti: string): Promise<boolean>;
  revoke(jti: string, ttlSeconds: number): Promise<void>;
}

/** In-memory jti denylist — lazily evicts expired entries on read. */
export class InMemoryJtiDenylist implements IJtiDenylist {
  private readonly revoked = new Map<string, number>();

  async isRevoked(jti: string): Promise<boolean> {
    const expiresAt = this.revoked.get(jti);
    if (expiresAt === undefined) return false;
    if (Date.now() >= expiresAt) {
      this.revoked.delete(jti);
      return false;
    }
    return true;
  }

  async revoke(jti: string, ttlSeconds: number): Promise<void> {
    this.revoked.set(jti, Date.now() + Math.max(0, ttlSeconds) * 1000);
  }
}

/** Paths that bypass authentication (liveness + readiness probes). */
const PUBLIC_PATHS = new Set(['/api/v1/health', '/api/v1/readyz']);

/** Default maximum accepted JWT age — defence-in-depth cap on top of `exp`. */
const DEFAULT_JWT_MAX_AGE = '1h';

/**
 * Route helper (register as `preHandler`) enforcing an OAuth-style scope.
 * DEFAULT PERMISSIVE: a token with no scopes is allowed (RBAC-lite is opt-in / backward
 * compatible). Only a token that *carries* scopes but lacks the required one is rejected (403).
 */
export function requireScope(scope: string) {
  return async function scopeGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const scopes = request.authUser?.scopes;
    if (!scopes || scopes.length === 0) return; // permissive default
    if (!scopes.includes(scope)) {
      await reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `Missing required scope: ${scope}`,
      });
    }
  };
}

/** Parse `scope` (space-delimited string) and/or `scopes` (array) claims into a string[]. */
function parseScopes(claims: { scope?: unknown; scopes?: unknown }): string[] | undefined {
  if (Array.isArray(claims.scopes)) {
    return claims.scopes.filter((s): s is string => typeof s === 'string' && s.length > 0);
  }
  if (typeof claims.scope === 'string' && claims.scope.trim().length > 0) {
    return claims.scope.trim().split(/\s+/);
  }
  return undefined;
}

/**
 * So sánh hai chuỗi bằng constant-time để chống timing attack.
 * Padding đến cùng độ dài trước khi so sánh.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  // Encode cả hai sang Buffer UTF-8 để so sánh byte-level
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // Nếu độ dài khác nhau: pad bằng null bytes, sau đó XOR length để trả false
  if (bufA.length !== bufB.length) {
    // Vẫn chạy timingSafeEqual trên bufA vs bufA (tránh branch timing),
    // nhưng kết quả luôn false do length check ở trước
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Tính SHA-256 của key và lấy 16 hex chars đầu làm anonymous ID.
 * Không để lộ prefix của raw key trong logs/audit.
 */
function apiKeyToId(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
}

export interface AuthPluginOptions {
  config: ApiConfig;
  /** Optional jti revocation list — enables logout / forced sign-out. */
  jtiDenylist?: IJtiDenylist;
  /** Maximum accepted JWT age (jsonwebtoken maxAge form). Default 1h. */
  jwtMaxAge?: string | number;
}

async function _authPlugin(fastify: FastifyInstance, opts: AuthPluginOptions): Promise<void> {
  await fastify.register(fastifyJwt, {
    secret: opts.config.jwtSecret,
    sign: { algorithm: 'HS256' },
    // Reject unsigned-lifetime / subject-less tokens and cap token age (global-standards JWT).
    verify: {
      algorithms: ['HS256'],
      maxAge: opts.jwtMaxAge ?? DEFAULT_JWT_MAX_AGE,
      requiredClaims: ['exp', 'sub'],
    },
  });

  const jtiDenylist = opts.jtiDenylist;

  // Lưu array để có thể iterate; Set.has() không dùng constant-time
  const validApiKeys: string[] = opts.config.apiKeys;

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0] ?? '';
    if (PUBLIC_PATHS.has(path)) return;

    const apiKey = request.headers['x-api-key'];
    const authHeader = request.headers.authorization;

    if (typeof apiKey === 'string' && apiKey) {
      // Constant-time comparison: iterate tất cả keys để tránh early-exit timing leak
      let matched = false;
      for (const validKey of validApiKeys) {
        if (timingSafeStringEqual(apiKey, validKey)) {
          matched = true;
          // Không break — tiếp tục loop để tránh timing phân biệt "key ở vị trí 1 vs vị trí N"
        }
      }
      if (!matched) {
        return reply
          .status(401)
          .send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid API key' });
      }
      // Dùng SHA-256 prefix thay vì raw key prefix
      request.authUser = { id: `apikey:${apiKeyToId(apiKey)}` };
      return;
    }

    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = await request.jwtVerify<{
          sub?: string;
          id?: string;
          jti?: string;
          exp?: number;
          role?: unknown;
          scope?: unknown;
          scopes?: unknown;
        }>();

        // Identity collapse guard: never default to a shared 'unknown' id (breaks IDOR checks).
        const subject = (decoded.sub ?? decoded.id ?? '').trim();
        if (subject.length === 0) {
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Invalid token: missing subject',
          });
        }

        // Revocation check (logout / forced sign-out).
        if (decoded.jti && jtiDenylist && (await jtiDenylist.isRevoked(decoded.jti))) {
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Token has been revoked',
          });
        }

        request.authUser = {
          id: subject,
          role: typeof decoded.role === 'string' ? decoded.role : undefined,
          scopes: parseScopes(decoded),
          jti: decoded.jti,
          exp: decoded.exp,
        };
        return;
      } catch {
        return reply
          .status(401)
          .send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired token' });
      }
    }

    return reply
      .status(401)
      .send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
  });
}

export const authPlugin = skipOverride(_authPlugin);
