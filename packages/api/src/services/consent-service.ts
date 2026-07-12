/**
 * ConsentService — ghi consent record vào audit log + persist consent state.
 *
 * PRIVACY:
 *  - Nhận raw userId nhưng hash ngay bằng keyed HMAC-SHA256(HMAC_SECRET), 16-hex
 *    (thống nhất với ExportService/SummaryService — không dùng unkeyed SHA-256 nữa)
 *  - metadata chỉ chứa consentType và versionHash — không chứa PHI
 *  - Consent state được persist keyed theo userIdHash (không PHI) qua store
 *    Redis-with-mem-fallback, để summary path (Lane F) query trước khi gọi AI.
 */

import { createHmac } from 'node:crypto';
import type { AuditSink } from './audit-service.js';
import type { IRedisStore } from './redis-store.js';

export type ConsentType = 'crossborder_ai';

export interface RecordConsentParams {
  /** Raw user ID từ JWT/API key — sẽ được hash keyed-HMAC trong service */
  userId: string;
  consentType: ConsentType;
  consentVersionHash: string;
  granted: boolean;
}

/** Trạng thái consent được persist (không chứa PHI, chỉ hashed key). */
export interface ConsentState {
  granted: boolean;
  versionHash: string;
  updatedAt: number;
}

/**
 * TTL cho consent state: 24 giờ.
 * Bounded để tránh consent "dính vĩnh viễn" trên máy trạm dùng chung (clinic shared PC).
 */
const CONSENT_TTL_SECONDS = 24 * 60 * 60;

export class ConsentService {
  private readonly hmacSecret: string;
  private readonly store: IRedisStore | null;

  constructor(
    private readonly auditSink: AuditSink,
    store?: IRedisStore,
    hmacSecret?: string,
  ) {
    this.store = store ?? null;
    this.hmacSecret =
      hmacSecret ?? process.env['HMAC_SECRET'] ?? 'dev-only-fallback-salt-32-chars-min';
  }

  /** Keyed HMAC-SHA256 truncated 16-hex — nhất quán với các service khác. */
  private hashUserId(userId: string): string {
    return createHmac('sha256', this.hmacSecret).update(userId, 'utf8').digest('hex').slice(0, 16);
  }

  private consentKey(userIdHash: string, consentType: ConsentType): string {
    return `consent:${userIdHash}:${consentType}`;
  }

  /**
   * Ghi một consent event vào audit log + persist state.
   * action = 'consent_grant' nếu granted=true, 'consent_revoke' nếu false.
   */
  async recordConsent(params: RecordConsentParams): Promise<void> {
    const { userId, consentType, consentVersionHash, granted } = params;

    const userIdHash = this.hashUserId(userId);

    if (this.store) {
      const state: ConsentState = {
        granted,
        versionHash: consentVersionHash,
        updatedAt: Date.now(),
      };
      await this.store.set(this.consentKey(userIdHash, consentType), state, CONSENT_TTL_SECONDS);
    }

    await this.auditSink.write({
      timestamp: new Date().toISOString(),
      userIdHash,
      action: granted ? 'consent_grant' : 'consent_revoke',
      status: 'success',
      metadata: {
        consentType,
        versionHash: consentVersionHash,
      },
    });
  }

  /**
   * Query consent state — dùng bởi summary path (Lane F) để gate PHI-to-AI.
   * Trả false nếu chưa từng grant, đã revoke, đã hết hạn TTL, hoặc không có store.
   */
  async hasConsent(userId: string, consentType: ConsentType): Promise<boolean> {
    if (!this.store) return false;
    const state = await this.store.get<ConsentState>(
      this.consentKey(this.hashUserId(userId), consentType),
    );
    return state?.granted === true;
  }
}
