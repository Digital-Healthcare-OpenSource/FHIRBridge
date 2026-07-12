/**
 * JobRecordStore<T> — generic job-record lifecycle store (DRY).
 *
 * Redis-backed (optional) với in-memory fallback, chia sẻ giữa ExportService và
 * SummaryService để tránh copy-paste (nguồn gốc của 3 bug drift trước đây):
 *  - TTL + periodic sweep (setInterval.unref) — không chỉ evict lazy khi getStatus
 *  - Max-entries cap trên in-memory Map (evict-oldest) — chống DoS memory
 *  - Ownership check + audit hook cho cross-tenant denial (IDOR)
 *  - Large-record handling: khi record vượt ngưỡng bytes cho Redis, giữ in-memory
 *    và XOÁ stale Redis key để getStatus không đọc bản 'processing' cũ rồi 404.
 *
 * PRIVACY: keys phải không chứa PHI (chỉ hashed IDs). Records có thể giữ PHI
 * trong memory tạm thời (≤ TTL) và không bao giờ ghi xuống durable storage ở đây.
 */

import { createHmac } from 'node:crypto';
import type { IRedisStore } from './redis-store.js';
import type { AuditService } from './audit-service.js';

/** Mọi job record đều mang owner id + thời điểm tạo (dùng cho ownership + TTL). */
export interface JobRecord {
  userId: string;
  createdAt: number;
}

/** Cấu hình audit cho cross-tenant denial (giống SummaryService cũ). */
export interface JobRecordAuditConfig {
  service: AuditService;
  /** HMAC key để hash user id trước khi vào audit trail (HMAC_SECRET). */
  hashKey: string;
  /** Action name cho denial, vd 'export_access_denied'. */
  deniedAction: string;
  /** Tên field id trong metadata, vd 'export_id' hoặc 'summary_id'. */
  idField: string;
}

export interface JobRecordStoreOptions {
  redis?: IRedisStore | null;
  ttlSeconds: number;
  logger?: { warn(msg: string): void; error(msg: string): void };
  /** Ngưỡng bytes của serialized record; vượt ngưỡng → giữ in-memory (skip Redis). */
  maxRedisBytes?: number;
  /** Trần số entry trong in-memory Map; vượt trần → evict-oldest. */
  maxEntries?: number;
  /** Chu kỳ sweep TTL (ms). Mặc định 60s. */
  sweepIntervalMs?: number;
  audit?: JobRecordAuditConfig;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

/** HMAC-SHA256 truncated 16-hex — dùng thống nhất cho mọi userId hashing. */
export function hashUserId(userId: string, key: string): string {
  return createHmac('sha256', key).update(userId).digest('hex').slice(0, 16);
}

export class JobRecordStore<T extends JobRecord> {
  private readonly memStore = new Map<string, T>();
  private readonly redis: IRedisStore | null;
  private readonly ttlSeconds: number;
  private readonly ttlMs: number;
  private readonly logger: { warn(msg: string): void; error(msg: string): void };
  private readonly maxRedisBytes: number | null;
  private readonly maxEntries: number;
  private readonly audit: JobRecordAuditConfig | null;
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(options: JobRecordStoreOptions) {
    this.redis = options.redis ?? null;
    this.ttlSeconds = options.ttlSeconds;
    this.ttlMs = options.ttlSeconds * 1000;
    this.logger = options.logger ?? console;
    this.maxRedisBytes = options.maxRedisBytes ?? null;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.audit = options.audit ?? null;

    const interval = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.sweepTimer = setInterval(() => this.sweepExpired(), interval);
    // Đừng giữ process sống chỉ vì sweep timer
    this.sweepTimer.unref();
  }

  /**
   * Store/overwrite một record.
   * Xử lý big-record → in-memory (+ xoá stale Redis key), memory cap, và TTL sweep.
   */
  async set(id: string, record: T): Promise<void> {
    if (this.redis) {
      const serialized = JSON.stringify(record);
      if (this.maxRedisBytes !== null && serialized.length > this.maxRedisBytes) {
        // Record quá lớn cho Redis → giữ in-memory.
        // XOÁ key Redis cũ (vd bản 'processing') để loadRecord không đọc bản stale
        // rồi trả 'processing' mãi mãi → 404 sau khi record memory hết hạn.
        this.logger.warn(
          `[JobRecordStore] record ${id} exceeds ${this.maxRedisBytes} bytes, keeping in-memory`,
        );
        await this.redis.delete(id);
        this.setMemory(id, record);
        return;
      }
      await this.redis.set(id, record, this.ttlSeconds);
      return;
    }
    this.setMemory(id, record);
  }

  private setMemory(id: string, record: T): void {
    this.sweepExpired();
    // Evict-oldest khi vượt cap. Map giữ insertion order → key đầu tiên là cũ nhất.
    if (!this.memStore.has(id) && this.memStore.size >= this.maxEntries) {
      const oldest = this.memStore.keys().next().value;
      if (oldest !== undefined) this.memStore.delete(oldest);
    }
    this.memStore.set(id, record);
  }

  /** Load record không kiểm tra ownership (redis-first, rồi memory). */
  async get(id: string): Promise<T | undefined> {
    if (this.redis) {
      const fromRedis = await this.redis.get<T>(id);
      if (fromRedis) return fromRedis;
    }
    return this.memStore.get(id);
  }

  /**
   * Load record + enforce ownership.
   * Trả undefined khi missing HOẶC cross-tenant (không leak 403 timing); audit denial.
   * userId undefined → bỏ qua ownership check (internal/admin use).
   */
  async getOwned(id: string, userId?: string): Promise<T | undefined> {
    this.sweepExpired();
    const record = await this.get(id);
    if (!record) return undefined;
    if (userId !== undefined && record.userId !== userId) {
      await this.auditDenial(id, userId, record.userId);
      return undefined;
    }
    return record;
  }

  async delete(id: string): Promise<void> {
    this.memStore.delete(id);
    if (this.redis) await this.redis.delete(id);
  }

  private async auditDenial(id: string, attemptUserId: string, ownerUserId: string): Promise<void> {
    if (!this.audit) return;
    await this.audit.service.log({
      userIdHash: hashUserId(attemptUserId, this.audit.hashKey),
      action: this.audit.deniedAction,
      status: 'error',
      metadata: {
        [this.audit.idField]: id,
        owner_user_hash: hashUserId(ownerUserId, this.audit.hashKey),
        reason: 'cross_tenant',
      },
    });
  }

  /** Evict expired in-memory records theo TTL (createdAt). */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, record] of this.memStore.entries()) {
      if (now - record.createdAt > this.ttlMs) this.memStore.delete(key);
    }
  }
}
