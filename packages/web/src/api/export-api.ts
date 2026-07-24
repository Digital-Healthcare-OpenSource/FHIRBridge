/**
 * Export API module — start, poll, and download FHIR export jobs.
 *
 * URL contract (server routes):
 *   POST   /api/v1/export              → { exportId, status }
 *   GET    /api/v1/export/:id/status   → { status, resourceCount, error }
 *   GET    /api/v1/export/:id/download → Blob
 *
 * NOTE: Server does NOT expose a list endpoint — listExports returns empty array.
 * Server response for status does not include `id`, `patientId`, `progress`,
 * `createdAt`, or `updatedAt`. We augment with client-tracked values where needed.
 */

import { apiClient } from './api-client';

export type ExportStatus = 'pending' | 'processing' | 'complete' | 'error';

/**
 * Shape returned by POST /api/v1/export (202 Accepted)
 */
export interface StartExportResponse {
  exportId: string;
  status: 'processing';
}

/**
 * Shape returned by GET /api/v1/export/:id/status.
 * Server enum: 'processing' | 'complete' | 'failed' (export-schemas.ts) —
 * client chuẩn hoá 'failed' → 'error' trong getStatus.
 */
export interface ExportStatusResponse {
  status: 'processing' | 'complete' | 'failed';
  resourceCount: number | null;
  error?: string;
}

/**
 * Client-side enriched job — augments server response with tracked metadata.
 * Fields marked optional are not available from the server status endpoint.
 */
export interface ExportJob {
  id: string;
  patientId?: string;
  status: ExportStatus;
  /** Not returned by server; derived from resourceCount presence (0–100 estimate). */
  progress: number;
  resourceCount: number;
  createdAt?: string;
  updatedAt?: string;
  error?: string;
}

export interface StartExportRequest {
  connectorType: 'fhir' | 'file';
  connectorConfig?: {
    url?: string;
    clientId?: string;
    clientSecret?: string;
  };
  patientId?: string;
  fileUploadId?: string;
  format?: 'json' | 'ndjson';
  includeSummary?: boolean;
  summaryProvider?: string;
  summaryLanguage?: string;
}

/**
 * Map server StartExportRequest shape — server expects patientId + connectorConfig
 * at top level, với field `baseUrl` (không phải `url` — schema export-schemas.ts).
 */
interface ServerExportBody {
  patientId?: string;
  connectorConfig: {
    type: string;
    baseUrl?: string;
    clientId?: string;
    clientSecret?: string;
  };
  outputFormat?: 'json' | 'ndjson';
  includeSummary?: boolean;
}

export const exportApi = {
  /** POST /api/v1/export — initiates async export, returns exportId */
  async startExport(req: StartExportRequest): Promise<ExportJob> {
    const body: ServerExportBody = {
      patientId: req.patientId,
      connectorConfig: {
        type: req.connectorType === 'fhir' ? 'fhir-endpoint' : 'file',
        baseUrl: req.connectorConfig?.url,
        clientId: req.connectorConfig?.clientId,
        clientSecret: req.connectorConfig?.clientSecret,
      },
      outputFormat: req.format,
      includeSummary: req.includeSummary,
    };
    const res = await apiClient.post<StartExportResponse>('/v1/export', body);
    return {
      id: res.exportId,
      patientId: req.patientId,
      status: 'processing',
      progress: 0,
      resourceCount: 0,
      createdAt: new Date().toISOString(),
    };
  },

  /** GET /api/v1/export/:id/status — poll job progress */
  async getStatus(jobId: string): Promise<ExportJob> {
    const res = await apiClient.get<ExportStatusResponse>(`/v1/export/${jobId}/status`);
    // Server nói 'failed', UI type dùng 'error' — không map thì poll không bao giờ dừng
    const status: ExportStatus = res.status === 'failed' ? 'error' : res.status;
    const progress =
      status === 'complete'
        ? 100
        : status === 'error'
          ? 0
          : res.resourceCount != null && res.resourceCount > 0
            ? 50
            : 10;
    return {
      id: jobId,
      status,
      progress,
      resourceCount: res.resourceCount ?? 0,
      error: res.error,
    };
  },

  /**
   * Server does not expose a list endpoint.
   * Returns empty array — callers should persist job IDs locally if needed.
   */
  async listExports(): Promise<ExportJob[]> {
    return [];
  },

  /** GET /api/v1/export/:id/download — download FHIR bundle as Blob */
  async downloadBundle(jobId: string): Promise<Blob> {
    return apiClient.download(`/v1/export/${jobId}/download`);
  },
};
