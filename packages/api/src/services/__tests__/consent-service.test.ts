/**
 * ConsentService — keyed HMAC hashing + persisted consent state.
 * MEDIUM fix: unkeyed SHA-256 → keyed HMAC-SHA256(HMAC_SECRET), 16-hex.
 * global-standards: consent state persisted (keyed by userIdHash) + hasConsent query.
 */

import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import type { AuditLogEntry } from '@fhirbridge/types';

import { ConsentService } from '../consent-service.js';
import type { AuditSink } from '../audit-service.js';
import type { IRedisStore } from '../redis-store.js';

class CapturingAuditSink implements AuditSink {
  entries: AuditLogEntry[] = [];
  async write(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class FakeRedis implements IRedisStore {
  readonly store = new Map<string, string>();
  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, JSON.stringify(value));
  }
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const raw = this.store.get(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  isHealthy(): boolean {
    return true;
  }
}

const SECRET = 'test-hmac-secret-32-chars-minimum-ok';

describe('ConsentService — keyed HMAC hashing', () => {
  it('hashes userId with keyed HMAC-SHA256 truncated to 16 hex (not unkeyed SHA-256)', async () => {
    const sink = new CapturingAuditSink();
    const svc = new ConsentService(sink, undefined, SECRET);

    await svc.recordConsent({
      userId: 'user-42',
      consentType: 'crossborder_ai',
      consentVersionHash: 'v1',
      granted: true,
    });

    expect(sink.entries).toHaveLength(1);
    const hash = sink.entries[0]!.userIdHash;
    expect(hash).toMatch(/^[0-9a-f]{16}$/);

    // Exactly the keyed HMAC, not the plain SHA-256
    const expected = createHmac('sha256', SECRET)
      .update('user-42', 'utf8')
      .digest('hex')
      .slice(0, 16);
    expect(hash).toBe(expected);

    const unkeyed = createHash('sha256').update('user-42', 'utf8').digest('hex');
    expect(hash).not.toBe(unkeyed);
    expect(hash).not.toBe(unkeyed.slice(0, 16));
  });

  it('records consent_grant / consent_revoke actions without PHI in metadata', async () => {
    const sink = new CapturingAuditSink();
    const svc = new ConsentService(sink, undefined, SECRET);

    await svc.recordConsent({
      userId: 'u',
      consentType: 'crossborder_ai',
      consentVersionHash: 'v9',
      granted: false,
    });

    const entry = sink.entries[0]!;
    expect(entry.action).toBe('consent_revoke');
    expect(entry.metadata).toEqual({ consentType: 'crossborder_ai', versionHash: 'v9' });
  });
});

describe('ConsentService — persisted consent state', () => {
  it('persists granted consent and hasConsent returns true', async () => {
    const store = new FakeRedis();
    const svc = new ConsentService(new CapturingAuditSink(), store, SECRET);

    await svc.recordConsent({
      userId: 'patient-op',
      consentType: 'crossborder_ai',
      consentVersionHash: 'v1',
      granted: true,
    });

    expect(await svc.hasConsent('patient-op', 'crossborder_ai')).toBe(true);
    // Stored keyed by hashed userId, never the raw id
    const key = [...store.store.keys()][0]!;
    expect(key).not.toContain('patient-op');
  });

  it('hasConsent returns false after revoke', async () => {
    const store = new FakeRedis();
    const svc = new ConsentService(new CapturingAuditSink(), store, SECRET);

    await svc.recordConsent({
      userId: 'u',
      consentType: 'crossborder_ai',
      consentVersionHash: 'v1',
      granted: true,
    });
    await svc.recordConsent({
      userId: 'u',
      consentType: 'crossborder_ai',
      consentVersionHash: 'v1',
      granted: false,
    });

    expect(await svc.hasConsent('u', 'crossborder_ai')).toBe(false);
  });

  it('hasConsent returns false when no store is configured', async () => {
    const svc = new ConsentService(new CapturingAuditSink(), undefined, SECRET);
    expect(await svc.hasConsent('u', 'crossborder_ai')).toBe(false);
  });
});
