/**
 * Summary service — orchestrates deidentify → AI generation → format.
 * Job-record lifecycle được uỷ cho JobRecordStore (redis-or-memory, TTL, sweep,
 * ownership + audit) — chia sẻ với ExportService để tránh drift.
 * No PHI in logs — only hashed IDs and counts.
 */

import { randomUUID } from 'node:crypto';
import {
  CLAUDE_DEFAULT_MODEL,
  OPENAI_DEFAULT_MODEL,
  ProviderGateway,
  formatMarkdown,
} from '@fhirbridge/core';
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

/** Read an optional env var, treating empty / whitespace-only values as unset. */
function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function buildSummaryConfig(
  options: SummaryRequestOptions = {},
  hmacSecret: string,
): SummaryConfig {
  const providerName = resolveProvider(options.provider);
  const apiKey =
    providerName === 'openai'
      ? (envValue('OPENAI_API_KEY') ?? '')
      : (envValue('ANTHROPIC_API_KEY') ?? '');
  // Operators pin a model per provider (ANTHROPIC_MODEL / OPENAI_MODEL); the
  // defaults live in core so API and CLI never drift apart.
  const model =
    providerName === 'openai'
      ? (envValue('OPENAI_MODEL') ?? OPENAI_DEFAULT_MODEL)
      : (envValue('ANTHROPIC_MODEL') ?? CLAUDE_DEFAULT_MODEL);

  return {
    language: options.language ?? 'en',
    detailLevel: options.detailLevel ?? 'standard',
    outputFormats: ['markdown'],
    hmacSecret,
    providerConfig: {
      provider: providerName,
      model,
      apiKey,
      // Headroom for current models, whose (adaptive) reasoning counts toward
      // max_tokens — a tight cap truncated section summaries mid-sentence.
      maxTokens: 16000,
      // Clinical: deterministic output where the provider supports it (OpenAI).
      // Current Claude models reject sampling params; ClaudeProvider omits it.
      temperature: 0,
      // Background job — allow for reasoning time instead of failing at 30s.
      timeoutMs: 120_000,
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
