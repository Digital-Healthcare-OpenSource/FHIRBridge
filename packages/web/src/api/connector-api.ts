/**
 * Connector API — test FHIR endpoint connections and upload source files.
 */

import { apiClient } from './api-client';

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  serverVersion?: string;
}

/**
 * Kết quả import — server /connectors/import xử lý ĐỒNG BỘ trong một request:
 * parse file → build bundle → trả {message, resourceCount, bundle}. Không có
 * bước staged-upload (không id/columns) — client chỉ cần resourceCount để hiển
 * thị kết quả, không ôm cả `bundle`.
 *
 * Result of an import — the server processes /connectors/import SYNCHRONOUSLY in
 * one request (parse → build bundle → return). There is no staged-upload step, so
 * no id/columns are returned; the client only needs the resource count.
 */
export interface ImportResult {
  message?: string;
  resourceCount?: number;
}

export const connectorApi = {
  /**
   * POST /api/v1/connectors/test
   * Server expects { type: 'fhir-endpoint', config: FhirEndpointConfig }.
   */
  async testConnection(
    url: string,
    clientId?: string,
    clientSecret?: string,
  ): Promise<ConnectionTestResult> {
    return apiClient.post<ConnectionTestResult>('/v1/connectors/test', {
      type: 'fhir-endpoint',
      config: { baseUrl: url, clientId, clientSecret },
    });
  },

  /**
   * POST /api/v1/connectors/import — multipart upload.
   * Server xử lý đồng bộ và trả kết quả import ngay trong response.
   * Server endpoint is /import (not /upload).
   */
  async importFile(file: File): Promise<ImportResult> {
    return apiClient.upload<ImportResult>('/v1/connectors/import', file);
  },
};
