/**
 * ImportPage — file upload → synchronous import → result.
 *
 * Server /connectors/import xử lý ĐỒNG BỘ: một request multipart parse file,
 * dựng FHIR Bundle và trả {message, resourceCount} ngay. Không có staged-upload
 * (không trả columns/rowCount), nên UI là một bước: chọn file → đang import →
 * xong / lỗi.
 *
 * Preview + column-mapping trong UI là một tính năng RIÊNG chưa làm — nó cần cả
 * (1) server transform RawRecord → resource FHIR hợp lệ (route /connectors/import
 * hiện add thẳng field-map phẳng, chưa qua resource-transformer), và (2) client
 * parse header CSV để dựng bảng chọn cột. Cho tới khi cả hai được làm, UI không
 * hứa một luồng preview/mapping không tồn tại (xem consensus / PR follow-up).
 */

import { useState, useCallback } from 'react';
import { PageContainer } from '../components/layout/page-container';
import { FileDropzone } from '../components/import/file-dropzone';
import { LoadingSpinner } from '../components/shared/loading-spinner';
import { connectorApi, type ImportResult } from '../api/connector-api';

type Stage = 'upload' | 'importing' | 'done' | 'error';

export function ImportPage() {
  const [stage, setStage] = useState<Stage>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFilesAccepted = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setSelectedFile(file);
    setStage('importing');
    try {
      const res = await connectorApi.importFile(file);
      setResult(res);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setStage('error');
    }
  }, []);

  const handleReset = () => {
    setStage('upload');
    setSelectedFile(null);
    setResult(null);
    setError(null);
  };

  return (
    <PageContainer
      title="Import File"
      description="Upload CSV, XLSX or FHIR JSON and map to FHIR R4"
    >
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Stage 1 — Upload */}
        {stage === 'upload' && (
          <FileDropzone
            onFilesAccepted={(files) => void handleFilesAccepted(files)}
            selectedFile={selectedFile}
          />
        )}

        {/* Stage 2 — Importing (server xử lý đồng bộ) */}
        {stage === 'importing' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <LoadingSpinner size="lg" />
            <p className="text-sm text-gray-500">Processing import…</p>
            {selectedFile && <p className="text-xs text-gray-400">{selectedFile.name}</p>}
          </div>
        )}

        {/* Stage 3 — Done */}
        {stage === 'done' && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-5 dark:border-green-800 dark:bg-green-900/20">
            <p className="font-medium text-green-800 dark:text-green-200">
              {result?.resourceCount != null
                ? `Import complete — ${result.resourceCount} resources processed`
                : 'Import complete'}
            </p>
            {selectedFile && (
              <p className="mt-1 text-sm text-green-700 dark:text-green-300">{selectedFile.name}</p>
            )}
            <button
              type="button"
              onClick={handleReset}
              className="mt-3 rounded-md bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-800"
            >
              Import another file
            </button>
          </div>
        )}

        {/* Stage 4 — Error */}
        {stage === 'error' && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-900/20">
            <p className="font-medium text-red-700 dark:text-red-300">Import failed</p>
            <p className="mt-1 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={handleReset}
              className="mt-3 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
