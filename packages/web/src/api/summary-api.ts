/**
 * Summary API — generate and download AI-generated patient summaries.
 *
 * URL contract (server routes):
 *   POST  /api/v1/summary/generate         → { summaryId, status }
 *   GET   /api/v1/summary/:id/download     → Blob (markdown or composition)
 *
 * NOTE: Server does NOT expose a status-polling endpoint for summaries.
 * Generation is treated as fire-and-poll against the download endpoint.
 * PDF download is not supported server-side; markdown only.
 */

import { apiClient } from './api-client';

export type SummaryStatus = 'pending' | 'processing' | 'complete' | 'error';

/**
 * Shape returned by POST /api/v1/summary/generate (202 Accepted)
 */
export interface StartSummaryResponse {
  summaryId: string;
  status: 'processing';
}

/**
 * Client-side enriched summary job.
 * Fields without server backing are tracked client-side only.
 */
export interface SummaryJob {
  id: string;
  exportId?: string;
  status: SummaryStatus;
  provider?: string;
  language?: string;
  detailLevel?: 'brief' | 'standard' | 'detailed';
  content?: string;
  createdAt?: string;
  error?: string;
}

/** Codes accepted by the server (packages/api/src/schemas/summary-schemas.ts). */
export type SummaryLanguageCode = 'en' | 'vi' | 'ja' | 'ko';
export type SummaryProvider = 'claude' | 'openai';

export interface GenerateSummaryRequest {
  exportId: string;
  provider: SummaryProvider | string;
  /** Ignored by the server (the operator pins models via ANTHROPIC_MODEL / OPENAI_MODEL). */
  model?: string;
  language: SummaryLanguageCode | string;
  detailLevel: 'brief' | 'standard' | 'detailed';
}

export const summaryApi = {
  /**
   * POST /api/v1/summary/generate
   * The server resolves `exportId` to the caller's finished export bundle
   * (ownership-checked), so the browser never has to hold or re-upload it.
   */
  async generateSummary(req: GenerateSummaryRequest): Promise<SummaryJob> {
    const body = {
      exportId: req.exportId,
      summaryConfig: {
        provider: req.provider,
        language: req.language,
        detailLevel: req.detailLevel,
      },
    };
    const res = await apiClient.post<StartSummaryResponse>('/v1/summary/generate', body);
    return {
      id: res.summaryId,
      exportId: req.exportId,
      status: 'processing',
      provider: req.provider,
      language: req.language,
      detailLevel: req.detailLevel,
      createdAt: new Date().toISOString(),
    };
  },

  /**
   * Server does not expose a summary status endpoint.
   * Polls download endpoint — 409 means still processing, 200 means complete,
   * anything else (e.g. 502 generation failed) is terminal.
   * Returns a SummaryJob with content when complete.
   */
  async getStatus(summaryId: string): Promise<SummaryJob> {
    try {
      const blob = await apiClient.download(`/v1/summary/${summaryId}/download`);
      const content = await blob.text();
      return { id: summaryId, status: 'complete', content };
    } catch (err: unknown) {
      // 409 = still processing, anything else = error
      const status =
        err instanceof Error && 'status' in err ? (err as { status: number }).status : 0;
      if (status === 409) {
        return { id: summaryId, status: 'processing' };
      }
      return {
        id: summaryId,
        status: 'error',
        error: err instanceof Error ? err.message : 'Summary generation failed',
      };
    }
  },

  /** GET /api/v1/summary/:id/download?format=markdown */
  async downloadMarkdown(summaryId: string): Promise<Blob> {
    return apiClient.download(`/v1/summary/${summaryId}/download?format=markdown`);
  },

  /**
   * Server does not support PDF export; falls back to markdown download.
   * Caller receives a .md Blob — filename handling is the caller's responsibility.
   */
  async downloadPdf(summaryId: string): Promise<Blob> {
    return apiClient.download(`/v1/summary/${summaryId}/download?format=markdown`);
  },
};
