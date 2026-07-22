/**
 * Summary service — orchestrates deidentify → AI generation → format.
 * Job-record lifecycle được uỷ cho JobRecordStore (redis-or-memory, TTL, sweep,
 * ownership + audit) — chia sẻ với ExportService để tránh drift.
 * No PHI in logs — only hashed IDs and counts.
 */

import { randomUUID } from 'node:crypto';
import { ProviderGateway, formatMarkdown } from '@fhirbridge/core';
import type { Bundle, SummaryConfig, PatientSummary } from '@fhirbridge/types';
import type { IRedisStore } from './redis-store.js';
import type { AuditService } from './audit-service.js';
import { JobRecordStore } from './job-record-store.js';

export interface SummaryRequestOptions {
  language?: 'en' | 'vi' | 'ja' | 'ko';
  provider?: 'claude' | 'openai';
  detailLevel?: 'brief' | 'standard' | 'detailed';
}

export interface SummaryRequest {
  bundle: Bundle;
  summaryConfig?: SummaryRequestOptions;
  hmacSecret: string;
  /** ID của user khởi tạo — lưu vào record để enforce ownership */
  userId: string;
}

export type SummaryStatus = 'processing' | 'complete' | 'failed';

export interface SummaryRecord {
  status: SummaryStatus;
  /** ID của user tạo summary — dùng cho IDOR ownership check */
  userId: string;
  summary?: PatientSummary;
  formattedMarkdown?: string;
  error?: string;
  createdAt: number;
}

/** TTL for summary records: 10 minutes */
const SUMMARY_TTL_SECONDS = 10 * 60;

function resolveProvider(provider?: string): 'claude' | 'openai' {
  if (provider === 'openai') return 'openai';
  return 'claude';
}

function buildSummaryConfig(
  options: SummaryRequestOptions = {},
  hmacSecret: string,
): SummaryConfig {
  const providerName = resolveProvider(options.provider);
  const apiKey =
    providerName === 'openai'
      ? (process.env['OPENAI_API_KEY'] ?? '')
      : (process.env['ANTHROPIC_API_KEY'] ?? '');

  return {
    language: options.language ?? 'en',
    detailLevel: options.detailLevel ?? 'standard',
    outputFormats: ['markdown'],
    hmacSecret,
    providerConfig: {
      provider: providerName,
      model: providerName === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-20250514',
      apiKey,
      maxTokens: 2048,
      // Clinical: deterministic output — không để model bịa/biến thiên trên nội dung y khoa.
      temperature: 0,
      timeoutMs: 30000,
    },
  };
}

export class SummaryService {
  private readonly store: JobRecordStore<SummaryRecord>;

  constructor(redisStore?: IRedisStore, auditService?: AuditService, auditHashSalt?: string) {
    const hashKey =
      auditHashSalt ?? process.env['HMAC_SECRET'] ?? 'dev-only-fallback-salt-32-chars-min';

    this.store = new JobRecordStore<SummaryRecord>({
      redis: redisStore ?? null,
      ttlSeconds: SUMMARY_TTL_SECONDS,
      ...(auditService
        ? {
            audit: {
              service: auditService,
              hashKey,
              deniedAction: 'summary_access_denied',
              idField: 'summary_id',
            },
          }
        : {}),
    });
  }

  /** Start async summary generation. Returns summaryId immediately. */
  async startGeneration(request: SummaryRequest): Promise<string> {
    const summaryId = randomUUID();
    await this.store.set(summaryId, {
      status: 'processing',
      userId: request.userId,
      createdAt: Date.now(),
    });
    this.runGeneration(summaryId, request).catch(() => {
      /* lỗi đã được lưu vào record.status = 'failed' */
    });
    return summaryId;
  }

  /**
   * Lấy trạng thái summary job.
   * Nếu truyền userId, kiểm tra ownership — trả undefined nếu không khớp (treat as 404).
   * Cross-tenant attempt được audit qua JobRecordStore (AC-2).
   */
  async getStatus(summaryId: string, userId?: string): Promise<SummaryRecord | undefined> {
    return this.store.getOwned(summaryId, userId);
  }

  /** Internal: run the full AI pipeline */
  private async runGeneration(summaryId: string, request: SummaryRequest): Promise<void> {
    // MEDIUM: handle undefined explicitly thay vì non-null assert race với TTL.
    const existing = await this.store.get(summaryId);
    if (!existing) {
      await this.store.set(summaryId, {
        status: 'failed',
        userId: request.userId,
        createdAt: Date.now(),
        error: 'Summary record expired before processing',
      });
      return;
    }

    try {
      const config = buildSummaryConfig(request.summaryConfig, request.hmacSecret);
      const gateway = new ProviderGateway(config);
      const summary = await gateway.summarize(request.bundle, config);

      // Immutable update — không mutate record có thể đang được chia sẻ.
      const completed: SummaryRecord = {
        ...existing,
        summary,
        formattedMarkdown: formatMarkdown(summary),
        status: 'complete',
      };
      await this.store.set(summaryId, completed);
    } catch (err) {
      const failed: SummaryRecord = {
        ...existing,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Summary generation failed',
      };
      await this.store.set(summaryId, failed);
    }
  }
}
