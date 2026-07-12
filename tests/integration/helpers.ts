/**
 * Integration test helpers.
 * Provides a pre-configured test server and JWT factory functions.
 * No Docker required — uses ConsoleAuditSink and in-memory stores.
 */

import { sign } from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../packages/api/src/server.js';
import type { ApiConfig } from '../../packages/api/src/config.js';

export const TEST_JWT_SECRET = 'test-jwt-secret-for-testing-only-min32chars';
export const TEST_HMAC_SECRET = 'test-hmac-secret-for-testing-only-min32ch';

export const TEST_CONFIG: ApiConfig = {
  port: 3002,
  host: '0.0.0.0',
  jwtSecret: TEST_JWT_SECRET,
  hmacSecret: TEST_HMAC_SECRET,
  apiKeys: ['test-key-1', 'test-key-2'],
  corsOrigins: ['http://localhost:4173'],
  logLevel: 'silent',
  trustProxy: false,
  // No databaseUrl / redisUrl — uses in-memory fallbacks
};

/** Generic protected route used by integration / security tests as a probe target. */
export const PROTECTED_PROBE_URL = '/api/v1/connectors/test';

/** Create and return a ready Fastify instance using test config */
export async function createTestServer(): Promise<FastifyInstance> {
  const server = await createServer(TEST_CONFIG);
  await server.ready();
  return server;
}

/**
 * Sign a JWT with an arbitrary payload.
 * Auth plugin yêu cầu claim `sub` + `exp`; tự suy `sub` từ `id` khi thiếu để
 * các call site cũ (`makeJwt({ id })`) vẫn tạo token hợp lệ. Truyền `sub`
 * tường minh (hoặc payload không có `id`) nếu muốn test token thiếu subject.
 */
export function makeJwt(
  payload: Record<string, unknown>,
  secret: string = TEST_JWT_SECRET,
  options: { expiresIn?: string | number } = { expiresIn: '1h' },
): string {
  const withSub =
    payload['sub'] === undefined && typeof payload['id'] === 'string'
      ? { sub: payload['id'], ...payload }
      : payload;
  return sign(withSub, secret, options as Parameters<typeof sign>[2]);
}

/** JWT for a generic test user */
export function userJwt(id = 'user-test'): string {
  return makeJwt({ sub: id, id });
}

/** Build Authorization header value */
export function bearerHeader(token: string): string {
  return `Bearer ${token}`;
}

/** Minimal valid FHIR Bundle for summary/export tests */
export const MINIMAL_BUNDLE = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      resource: {
        resourceType: 'Patient',
        id: 'test-patient',
        name: [{ family: 'Doe', given: ['John'] }],
      },
    },
  ],
};
