/**
 * Postgres-backed AuditSink — batches writes for efficiency.
 * Implements the AuditSink interface from audit-service.ts.
 * PRIVACY: only receives pre-hashed user IDs, no raw PHI.
 *
 * BOUNDED QUEUE: pending array bị giới hạn ở MAX_PENDING_ENTRIES để ngăn OOM
 * khi Postgres down kéo dài. Khi queue đầy, entry CŨ NHẤT bị drop (FIFO eviction).
 */

import { Pool } from 'pg';
import type { AuditLogEntry } from '@fhirbridge/types';
import type { AuditSink } from './audit-service.js';

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_BATCH_SIZE = 50;

/**
 * Giới hạn tối đa entries trong pending queue.
 * Khi Postgres down, mỗi write + mỗi re-queue đều push vào pending.
 * Không có bound → unbounded growth → OOM.
 * 10_000 entries ~ 10_000 × ~500B = ~5MB — an toàn dưới áp lực cao.
 */
const MAX_PENDING_ENTRIES = 10_000;

/** Cứ mỗi bao nhiêu lần drop thì log warning một lần — tránh flood logs */
const DROP_LOG_INTERVAL = 1_000;

export class PostgresAuditSink implements AuditSink {
  private readonly pool: Pool;
  private readonly pending: AuditLogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private healthy = false;

  /**
   * Đếm tổng số entries bị drop do queue đầy.
   * Dùng cho observability — expose qua getDroppedEntryCount().
   */
  private droppedEntryCount = 0;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
    });

    this.pool.on('error', (err) => {
      console.error('[PostgresAuditSink] pool error:', err.message);
      this.healthy = false;
    });

    // Probe connection on startup
    this.pool
      .query('SELECT 1')
      .then(() => {
        this.healthy = true;
      })
      .catch((err: Error) => {
        console.error('[PostgresAuditSink] initial connection check failed:', err.message);
      });

    this.flushTimer = setInterval(() => {
      this.flush().catch((err: Error) => {
        console.error('[PostgresAuditSink] scheduled flush failed:', err.message);
      });
    }, FLUSH_INTERVAL_MS);

    // Allow process to exit — unref the timer
    this.flushTimer.unref();
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  /**
   * Tổng số entries bị drop do bounded queue overflow.
   * Metric này dùng cho /metrics endpoint hoặc health check dashboard.
   * Counter không reset — cumulative để dễ alert khi tăng bất thường.
   */
  getDroppedEntryCount(): number {
    return this.droppedEntryCount;
  }

  /**
   * Số entries đang chờ flush trong queue.
   * Dùng cho /metrics endpoint để monitor backlog size.
   */
  getPendingCount(): number {
    return this.pending.length;
  }

  /**
   * Push một entry vào bounded queue.
   * Nếu queue đã đầy (>= MAX_PENDING_ENTRIES), drop entry CŨ NHẤT (FIFO eviction)
   * trước khi push entry mới — ưu tiên data mới hơn data cũ.
   */
  private pushBounded(entry: AuditLogEntry): void {
    if (this.pending.length >= MAX_PENDING_ENTRIES) {
      // Drop oldest entry để nhường chỗ cho entry mới
      this.pending.shift();
      this.droppedEntryCount++;

      // Log warning theo interval — tránh flood logs khi Postgres down kéo dài
      if (this.droppedEntryCount % DROP_LOG_INTERVAL === 0) {
        console.warn(
          `[PostgresAuditSink] bounded queue overflow: ${this.droppedEntryCount} entries dropped total. ` +
            `Postgres may be down or overloaded.`,
        );
      }
    }
    this.pending.push(entry);
  }

  /** Collect entry for batched write — never blocks caller */
  async write(entry: AuditLogEntry): Promise<void> {
    this.pushBounded(entry);
    if (this.pending.length >= FLUSH_BATCH_SIZE) {
      this.flush().catch((err: Error) => {
        console.error('[PostgresAuditSink] batch flush failed:', err.message);
      });
    }
  }

  /** Flush all pending entries to Postgres */
  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0, this.pending.length);

    const client = await this.pool.connect().catch((err: Error) => {
      console.error('[PostgresAuditSink] flush: connect failed:', err.message);
      // Re-queue entries qua pushBounded để đảm bảo bound được giữ nguyên.
      // Nếu queue gần đầy, các entries cũ nhất trong batch sẽ bị drop —
      // đây là trade-off chấp nhận được so với OOM.
      for (const e of batch) {
        this.pushBounded(e);
      }
      return null;
    });
    if (!client) return;

    try {
      this.healthy = true;
      const values: unknown[] = [];
      const placeholders = batch.map((entry, i) => {
        const base = i * 6;
        values.push(
          entry.timestamp,
          entry.userIdHash,
          entry.action,
          entry.status,
          entry.resourceCount ?? null,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb)`;
      });

      await client.query(
        `INSERT INTO audit_logs (timestamp, user_id_hash, action, status, resource_count, metadata)
         VALUES ${placeholders.join(', ')}`,
        values,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[PostgresAuditSink] INSERT failed:', msg);
      this.healthy = false;
    } finally {
      client.release();
    }
  }

  /**
   * Retention purge — gọi purge_audit_logs() (SECURITY DEFINER từ migration 002)
   * xoá row cũ hơn retentionDays. Trả về số row đã xoá. Ném lỗi cho caller
   * (AuditRetentionService) xử lý fail-soft.
   */
  async purgeExpired(retentionDays: number): Promise<number> {
    const result = await this.pool.query<{ deleted: number }>(
      'SELECT purge_audit_logs(make_interval(days => $1)) AS deleted',
      [retentionDays],
    );
    return result.rows[0]?.deleted ?? 0;
  }

  /** Graceful shutdown — flush remaining entries and close pool */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    await this.pool.end().catch((err: Error) => {
      console.error('[PostgresAuditSink] pool end error:', err.message);
    });
  }
}
