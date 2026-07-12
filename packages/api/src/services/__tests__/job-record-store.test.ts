/**
 * JobRecordStore — shared job-record lifecycle behavior.
 * Covers the bug fixes consolidated from ExportService/SummaryService:
 *  - large record (> maxRedisBytes) stays retrievable & deletes stale Redis key
 *  - TTL sweep evicts expired in-memory records
 *  - max-entries cap evicts oldest
 *  - cross-tenant ownership denial is audited (hashed ids)
 */

import { describe, it, expect } from 'vitest';
import type { AuditLogEntry } from '@fhirbridge/types';

import { JobRecordStore, hashUserId, type JobRecord } from '../job-record-store.js';
import { AuditService, type AuditSink } from '../audit-service.js';
import type { IRedisStore } from '../redis-store.js';

interface Rec extends JobRecord {
  status: string;
  blob?: string;
}

class FakeRedis implements IRedisStore {
  readonly store = new Map<string, string>();
  readonly deleted: string[] = [];
  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, JSON.stringify(value));
  }
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const raw = this.store.get(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  }
  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.store.delete(key);
  }
  isHealthy(): boolean {
    return true;
  }
}

class CapturingAuditSink implements AuditSink {
  entries: AuditLogEntry[] = [];
  async write(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

describe('JobRecordStore — large record handling (HIGH >5MB stale record)', () => {
  it('keeps oversized record in memory AND deletes the stale Redis key', async () => {
    const fake = new FakeRedis();
    const store = new JobRecordStore<Rec>({ redis: fake, ttlSeconds: 600, maxRedisBytes: 200 });

    // Small 'processing' record → goes to Redis
    await store.set('job1', { userId: 'u1', createdAt: Date.now(), status: 'processing' });
    expect(fake.store.has('job1')).toBe(true);

    // Large 'complete' record → exceeds threshold → memory + stale Redis key deleted
    await store.set('job1', {
      userId: 'u1',
      createdAt: Date.now(),
      status: 'complete',
      blob: 'x'.repeat(1000),
    });
    expect(fake.deleted).toContain('job1');
    expect(fake.store.has('job1')).toBe(false);

    // getStatus must return the COMPLETE record — not stuck on stale 'processing' then 404
    const rec = await store.getOwned('job1', 'u1');
    expect(rec?.status).toBe('complete');
  });
});

describe('JobRecordStore — TTL sweep', () => {
  it('evicts records older than TTL on access', async () => {
    const store = new JobRecordStore<Rec>({ ttlSeconds: 1 });
    await store.set('old', { userId: 'u1', createdAt: Date.now() - 5_000, status: 'processing' });
    expect(await store.getOwned('old', 'u1')).toBeUndefined();
  });

  it('keeps records within TTL', async () => {
    const store = new JobRecordStore<Rec>({ ttlSeconds: 600 });
    await store.set('fresh', { userId: 'u1', createdAt: Date.now(), status: 'processing' });
    expect(await store.getOwned('fresh', 'u1')).toBeDefined();
  });
});

describe('JobRecordStore — max-entries cap', () => {
  it('evicts the oldest entry when the cap is exceeded', async () => {
    const store = new JobRecordStore<Rec>({ ttlSeconds: 600, maxEntries: 2 });
    const now = Date.now();
    await store.set('a', { userId: 'u', createdAt: now, status: 'p' });
    await store.set('b', { userId: 'u', createdAt: now, status: 'p' });
    await store.set('c', { userId: 'u', createdAt: now, status: 'p' }); // evicts oldest 'a'

    expect(await store.get('a')).toBeUndefined();
    expect(await store.get('b')).toBeDefined();
    expect(await store.get('c')).toBeDefined();
  });
});

describe('JobRecordStore — ownership + audit', () => {
  it('audits cross-tenant denial and returns undefined', async () => {
    const sink = new CapturingAuditSink();
    const store = new JobRecordStore<Rec>({
      ttlSeconds: 600,
      audit: {
        service: new AuditService(sink),
        hashKey: 'k',
        deniedAction: 'export_access_denied',
        idField: 'export_id',
      },
    });
    await store.set('j', { userId: 'owner', createdAt: Date.now(), status: 'p' });

    expect(await store.getOwned('j', 'attacker')).toBeUndefined();
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]!.action).toBe('export_access_denied');
    expect(sink.entries[0]!.metadata?.['export_id']).toBe('j');
  });

  it('does not audit legitimate access, and skips ownership check when no userId', async () => {
    const sink = new CapturingAuditSink();
    const store = new JobRecordStore<Rec>({
      ttlSeconds: 600,
      audit: {
        service: new AuditService(sink),
        hashKey: 'k',
        deniedAction: 'export_access_denied',
        idField: 'export_id',
      },
    });
    await store.set('j', { userId: 'owner', createdAt: Date.now(), status: 'p' });

    expect(await store.getOwned('j', 'owner')).toBeDefined();
    expect(await store.getOwned('j')).toBeDefined(); // internal/admin, no ownership check
    expect(sink.entries).toHaveLength(0);
  });
});

describe('hashUserId', () => {
  it('is deterministic keyed HMAC truncated to 16 hex chars', () => {
    const a = hashUserId('user-1', 'secret-key');
    const b = hashUserId('user-1', 'secret-key');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    // Different key → different hash (keyed, not plain SHA-256)
    expect(hashUserId('user-1', 'other-key')).not.toBe(a);
  });
});
