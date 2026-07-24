/**
 * Tests for AuditRetentionService — scheduling, fail-soft, shutdown.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuditRetentionService } from '../audit-retention-service.js';

const logger = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AuditRetentionService', () => {
  it('purges immediately on start and again every interval', async () => {
    const purger = { purgeExpired: vi.fn().mockResolvedValue(3) };
    const svc = new AuditRetentionService(purger, 730, logger, 1000);

    svc.start();
    expect(purger.purgeExpired).toHaveBeenCalledTimes(1);
    expect(purger.purgeExpired).toHaveBeenCalledWith(730);

    await vi.advanceTimersByTimeAsync(2100);
    expect(purger.purgeExpired).toHaveBeenCalledTimes(3);

    svc.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(purger.purgeExpired).toHaveBeenCalledTimes(3);
  });

  it('start is idempotent — no double timers', async () => {
    const purger = { purgeExpired: vi.fn().mockResolvedValue(0) };
    const svc = new AuditRetentionService(purger, 90, logger, 1000);
    svc.start();
    svc.start();
    await vi.advanceTimersByTimeAsync(1050);
    // 1 lần lúc start + 1 lần sau 1 interval (không nhân đôi)
    expect(purger.purgeExpired).toHaveBeenCalledTimes(2);
    svc.stop();
  });

  it('logs the purged row count on success', async () => {
    const purger = { purgeExpired: vi.fn().mockResolvedValue(42) };
    const svc = new AuditRetentionService(purger, 90, logger, 1000);
    const deleted = await svc.runOnce();
    expect(deleted).toBe(42);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('purged 42'));
  });

  it('fail-soft: purge errors are logged as warn, never thrown', async () => {
    // Vd role runtime thiếu EXECUTE khi chưa chạy migration 002
    const purger = {
      purgeExpired: vi.fn().mockRejectedValue(new Error('permission denied for function')),
    };
    const svc = new AuditRetentionService(purger, 90, logger, 1000);
    const deleted = await svc.runOnce();
    expect(deleted).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('migration 002'));
  });

  it('stop before start is a no-op', () => {
    const purger = { purgeExpired: vi.fn() };
    const svc = new AuditRetentionService(purger, 90, logger, 1000);
    expect(() => svc.stop()).not.toThrow();
    expect(purger.purgeExpired).not.toHaveBeenCalled();
  });
});
