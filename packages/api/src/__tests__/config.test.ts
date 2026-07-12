/**
 * Tests for loadConfig — Zod validation of environment variables.
 * Focus: placeholder/low-entropy secret rejection and the newly-validated ad-hoc env vars.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

// A pair of high-entropy, distinct secrets (≥32 chars) that always pass.
const GOOD_JWT = 'k7Qx9mVzR2pLd4Wn8sT1yB6uH3aE0cGf5jN';
const GOOD_HMAC = 'Z1x8Cv4Bn7Mq2Wl9Ka3Sd6Fg0Hj5Ty2Rp8U';

const ENV_KEYS = [
  'NODE_ENV',
  'JWT_SECRET',
  'HMAC_SECRET',
  'RATE_LIMIT_PER_MINUTE',
  'ENABLE_DOCS',
  'AUDIT_RETENTION_DAYS',
  'ANTHROPIC_API_KEY',
  'AI_PROVIDER',
  'ERROR_DOCS_BASE_URL',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('loadConfig — secret hardening', () => {
  it('accepts distinct high-entropy secrets', () => {
    process.env['JWT_SECRET'] = GOOD_JWT;
    process.env['HMAC_SECRET'] = GOOD_HMAC;
    const config = loadConfig();
    expect(config.jwtSecret).toBe(GOOD_JWT);
    expect(config.hmacSecret).toBe(GOOD_HMAC);
  });

  it('REJECTS a placeholder secret containing "change-this" (any environment)', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['JWT_SECRET'] = 'change-this-secret-in-production-000001';
    process.env['HMAC_SECRET'] = GOOD_HMAC;
    expect(() => loadConfig()).toThrow(/jwtSecret/);
  });

  it('REJECTS a low-entropy secret in production (NODE_ENV=production)', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'a'.repeat(40);
    process.env['HMAC_SECRET'] = GOOD_HMAC;
    expect(() => loadConfig()).toThrow(/entropy/i);
  });

  it('allows a low-entropy secret OUTSIDE production (dev convenience)', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['JWT_SECRET'] = 'a'.repeat(40);
    process.env['HMAC_SECRET'] = 'b'.repeat(40);
    expect(() => loadConfig()).not.toThrow();
  });

  it('still rejects key reuse (JWT_SECRET === HMAC_SECRET)', () => {
    process.env['JWT_SECRET'] = GOOD_JWT;
    process.env['HMAC_SECRET'] = GOOD_JWT;
    expect(() => loadConfig()).toThrow(/HMAC_SECRET must be different/);
  });
});

describe('loadConfig — newly validated env vars', () => {
  beforeEach(() => {
    process.env['JWT_SECRET'] = GOOD_JWT;
    process.env['HMAC_SECRET'] = GOOD_HMAC;
  });

  it('coerces RATE_LIMIT_PER_MINUTE to a number (default 100)', () => {
    expect(loadConfig().rateLimitPerMinute).toBe(100);
    process.env['RATE_LIMIT_PER_MINUTE'] = '250';
    expect(loadConfig().rateLimitPerMinute).toBe(250);
  });

  it('rejects a non-numeric RATE_LIMIT_PER_MINUTE (typo fails fast)', () => {
    process.env['RATE_LIMIT_PER_MINUTE'] = 'lots';
    expect(() => loadConfig()).toThrow(/rateLimitPerMinute/);
  });

  it('parses ENABLE_DOCS as a boolean (default true)', () => {
    expect(loadConfig().enableDocs).toBe(true);
    process.env['ENABLE_DOCS'] = 'false';
    expect(loadConfig().enableDocs).toBe(false);
  });

  it('coerces AUDIT_RETENTION_DAYS (default 90)', () => {
    expect(loadConfig().auditRetentionDays).toBe(90);
    process.env['AUDIT_RETENTION_DAYS'] = '30';
    expect(loadConfig().auditRetentionDays).toBe(30);
  });

  it('rejects an invalid ERROR_DOCS_BASE_URL', () => {
    process.env['ERROR_DOCS_BASE_URL'] = 'not-a-url';
    expect(() => loadConfig()).toThrow(/errorDocsBaseUrl/);
  });
});
