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
 * file + column mapping → FHIR Bundle, trả về ngay kèm thống kê và cảnh báo.
 *
 * Result of an import — the server processes /connectors/import SYNCHRONOUSLY:
 * data file + column mapping → FHIR Bundle, returned with stats and warnings.
 */
export interface ImportResult {
  message?: string;
  resourceCount?: number;
  resourcesByType?: Record<string, number>;
  rowsRead?: number;
  warnings?: string[];
  warningCount?: number;
  bundle?: unknown;
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
   * POST /api/v1/connectors/import — multipart: `file` (CSV / Excel) + `mapping`
   * (column-mapping JSON text, see examples/column-mappings). Synchronous.
   */
  async importFile(file: File, mapping: string): Promise<ImportResult> {
    return apiClient.upload<ImportResult>('/v1/connectors/import', file, { mapping });
  },
};
