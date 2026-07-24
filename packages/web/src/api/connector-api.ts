/**
 * Connector API — test FHIR endpoint connections and upload source files.
 */

import { apiClient } from './api-client';

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  serverVersion?: string;
}

export interface UploadedFile {
  id: string;
  filename: string;
  sizeBytes: number;
  columns?: string[];
  rowCount?: number;
  uploadedAt: string;
  /**
   * Server /connectors/import hiện xử lý ĐỒNG BỘ và trả {message, resourceCount,
   * bundle} — không có id/columns. Client dùng resourceCount để hiển thị kết quả;
   * không giữ `bundle` trong type (client không cần ôm cả bundle).
   */
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
   * POST /api/v1/connectors/import — multipart upload
   * Server endpoint is /import (not /upload).
   */
  async uploadFile(file: File): Promise<UploadedFile> {
    return apiClient.upload<UploadedFile>('/v1/connectors/import', file);
  },
};
