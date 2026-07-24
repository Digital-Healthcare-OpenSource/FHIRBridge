/**
 * AuditRetentionService — lịch purge audit log ngay trong process API.
 *
 * Chỉ chạy khi operator set AUDIT_RETENTION_DAYS tường minh VÀ Postgres audit
 * sink đang bật. Không có default ngầm: tự động xoá audit data với một default
 * là rủi ro compliance (KR 접속기록 yêu cầu giữ ≥ 730 ngày, HIPAA thường 6 năm).
 *
 * Fail-soft theo invariant graceful-degradation: mọi lỗi purge (vd role runtime
 * thiếu EXECUTE trước khi chạy migration 002) chỉ log warn — không bao giờ làm
 * sập server hay chặn request path.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Nguồn thực thi purge — PostgresAuditSink implement method này. */
export interface RetentionPurger {
  purgeExpired(retentionDays: number): Promise<number>;
}

/** Subset logger (pino tương thích structural). */
export interface RetentionLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export class AuditRetentionService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly purger: RetentionPurger,
    private readonly retentionDays: number,
    private readonly logger: RetentionLogger,
    private readonly intervalMs: number = DAY_MS,
  ) {}

  /** Purge một lần ngay khi start, rồi lặp mỗi intervalMs (mặc định 24h). */
  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    // unref: timer không giữ process sống khi server shutdown
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Một chu kỳ purge, fail-soft. Trả số row đã xoá, hoặc null khi lỗi. */
  async runOnce(): Promise<number | null> {
    try {
      const deleted = await this.purger.purgeExpired(this.retentionDays);
      this.logger.info(
        `[AuditRetention] purged ${deleted} audit rows older than ${this.retentionDays} days`,
      );
      return deleted;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[AuditRetention] purge failed: ${msg} — nếu role runtime thiếu quyền EXECUTE, ` +
          `chạy migration 002 (pnpm --filter @fhirbridge/api migrate) hoặc schedule ` +
          `purge_audit_logs() qua pg_cron`,
      );
      return null;
    }
  }
}
