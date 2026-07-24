/**
 * Tests for exportApi — start, poll, and download FHIR export jobs.
 * URL contract: /v1/export (base /api prepended by constants.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportApi } from '../export-api';

// Mock the apiClient so we never hit the network
vi.mock('../api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    download: vi.fn(),
  },
}));

import { apiClient } from '../api-client';
const mockApiClient = vi.mocked(apiClient);

// Server StartExportResponse shape
const MOCK_START_RESPONSE = {
  exportId: 'job-abc',
  status: 'processing' as const,
};

// Server ExportStatusResponse shape
const MOCK_STATUS_RUNNING = {
  status: 'processing' as const,
  resourceCount: null,
};

const MOCK_STATUS_COMPLETE = {
  status: 'complete' as const,
  resourceCount: 42,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exportApi.startExport', () => {
  it('calls POST /v1/export with mapped server body', async () => {
    mockApiClient.post.mockResolvedValueOnce(MOCK_START_RESPONSE);
    const req = { connectorType: 'fhir' as const, format: 'json' as const, patientId: 'P001' };
    await exportApi.startExport(req);
    expect(mockApiClient.post).toHaveBeenCalledWith(
      '/v1/export',
      expect.objectContaining({
        patientId: 'P001',
        connectorConfig: expect.objectContaining({ type: 'fhir-endpoint' }),
      }),
    );
  });

  it('maps connectorConfig.url to server field baseUrl (export-schemas contract)', async () => {
    mockApiClient.post.mockResolvedValueOnce(MOCK_START_RESPONSE);
    await exportApi.startExport({
      connectorType: 'fhir',
      format: 'ndjson',
      patientId: 'P001',
      connectorConfig: { url: 'https://hapi.fhir.org/baseR4' },
    });
    const [, body] = mockApiClient.post.mock.calls[0] as [string, Record<string, unknown>];
    const cc = body['connectorConfig'] as Record<string, unknown>;
    expect(cc['baseUrl']).toBe('https://hapi.fhir.org/baseR4');
    expect(cc).not.toHaveProperty('url');
  });

  it('returns enriched ExportJob with id from exportId', async () => {
    mockApiClient.post.mockResolvedValueOnce(MOCK_START_RESPONSE);
    const job = await exportApi.startExport({ connectorType: 'fhir', format: 'json' });
    expect(job.id).toBe('job-abc');
    expect(job.status).toBe('processing');
    expect(job.progress).toBe(0);
  });
});

describe('exportApi.getStatus', () => {
  it('calls GET /v1/export/:id/status', async () => {
    mockApiClient.get.mockResolvedValueOnce(MOCK_STATUS_RUNNING);
    await exportApi.getStatus('job-abc');
    expect(mockApiClient.get).toHaveBeenCalledWith('/v1/export/job-abc/status');
  });

  it('returns progress=10 when still processing with no resources', async () => {
    mockApiClient.get.mockResolvedValueOnce(MOCK_STATUS_RUNNING);
    const job = await exportApi.getStatus('job-abc');
    expect(job.status).toBe('processing');
    expect(job.progress).toBe(10);
    expect(job.resourceCount).toBe(0);
  });

  it('returns progress=100 when complete', async () => {
    mockApiClient.get.mockResolvedValueOnce(MOCK_STATUS_COMPLETE);
    const job = await exportApi.getStatus('job-abc');
    expect(job.status).toBe('complete');
    expect(job.progress).toBe(100);
    expect(job.resourceCount).toBe(42);
  });

  it("maps server status 'failed' to UI status 'error' so polling stops", async () => {
    mockApiClient.get.mockResolvedValueOnce({
      status: 'failed',
      resourceCount: null,
      error: 'Blocked baseUrl',
    });
    const job = await exportApi.getStatus('job-abc');
    expect(job.status).toBe('error');
    expect(job.progress).toBe(0);
    expect(job.error).toBe('Blocked baseUrl');
  });
});

describe('exportApi.listExports', () => {
  it('returns empty array (no list endpoint on server)', async () => {
    const jobs = await exportApi.listExports();
    expect(jobs).toEqual([]);
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });
});

describe('exportApi.downloadBundle', () => {
  it('calls download with /v1/export/:id/download path', async () => {
    const blob = new Blob(['{}']);
    mockApiClient.download.mockResolvedValueOnce(blob);
    await exportApi.downloadBundle('job-abc');
    expect(mockApiClient.download).toHaveBeenCalledWith('/v1/export/job-abc/download');
  });

  it('returns the blob data', async () => {
    const blob = new Blob(['{"resourceType":"Bundle"}'], { type: 'application/json' });
    mockApiClient.download.mockResolvedValueOnce(blob);
    const result = await exportApi.downloadBundle('job-abc');
    expect(result).toBe(blob);
  });
});
