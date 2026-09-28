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
  'METRICS_BEARER_TOKEN',
  'OPENAI_API_KEY',
  'DATABASE_URL',
  'AUDIT_PROFILE',
  'ANTHROPIC_MODEL',
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

  it('coerces AUDIT_RETENTION_DAYS (opt-in, không default)', () => {
    expect(loadConfig().auditRetentionDays).toBeUndefined();
    process.env['AUDIT_RETENTION_DAYS'] = '30';
    expect(loadConfig().auditRetentionDays).toBe(30);
  });

  it('AUDIT_PROFILE: mặc định undefined, nhận kr, reject giá trị lạ', () => {
    expect(loadConfig().auditProfile).toBeUndefined();
    process.env['AUDIT_PROFILE'] = 'kr';
    expect(loadConfig().auditProfile).toBe('kr');
    process.env['AUDIT_PROFILE'] = 'eu';
    expect(() => loadConfig()).toThrow(/auditProfile/);
  });

  it('rejects an invalid ERROR_DOCS_BASE_URL', () => {
    process.env['ERROR_DOCS_BASE_URL'] = 'not-a-url';
    expect(() => loadConfig()).toThrow(/errorDocsBaseUrl/);
  });
});

describe('loadConfig — copy-pasted .env.example ergonomics', () => {
  beforeEach(() => {
    process.env['JWT_SECRET'] = GOOD_JWT;
    process.env['HMAC_SECRET'] = GOOD_HMAC;
  });

  it('treats empty values (`KEY=` lines in .env.example) as unset instead of failing boot', () => {
    process.env['METRICS_BEARER_TOKEN'] = '';
    process.env['ANTHROPIC_API_KEY'] = '';
    process.env['OPENAI_API_KEY'] = '   ';
    process.env['DATABASE_URL'] = '';
    const config = loadConfig();
    expect(config.metricsBearerToken).toBeUndefined();
    expect(config.anthropicApiKey).toBeUndefined();
    expect(config.openaiApiKey).toBeUndefined();
    expect(config.databaseUrl).toBeUndefined();
  });

  it('names the environment variable (not just the config field) in errors', () => {
    process.env['METRICS_BEARER_TOKEN'] = 'too-short';
    expect(() => loadConfig()).toThrow(/METRICS_BEARER_TOKEN \(metricsBearerToken\)/);
  });

  it('reports a missing HMAC_SECRET as missing (no silent fallback to JWT_SECRET)', () => {
    delete process.env['HMAC_SECRET'];
    expect(() => loadConfig()).toThrow(/HMAC_SECRET \(hmacSecret\): HMAC_SECRET is required/);
  });

  it('keeps the min-length message for a too-short secret', () => {
    process.env['JWT_SECRET'] = 'short';
    expect(() => loadConfig()).toThrow(/JWT_SECRET must be at least 32 characters/);
  });

  it('points the operator at the setup script', () => {
    delete process.env['JWT_SECRET'];
    expect(() => loadConfig()).toThrow(/pnpm run setup/);
  });

  it('reads ANTHROPIC_MODEL as an optional model pin', () => {
    expect(loadConfig().anthropicModel).toBeUndefined();
    process.env['ANTHROPIC_MODEL'] = 'claude-opus-5';
    expect(loadConfig().anthropicModel).toBe('claude-opus-5');
  });
});
