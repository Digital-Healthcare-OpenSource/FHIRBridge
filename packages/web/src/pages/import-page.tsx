/**
 * ImportPage — file upload → preview → column mapping → export.
 */

import { useState, useCallback } from 'react';
import { PageContainer } from '../components/layout/page-container';
import { FileDropzone } from '../components/import/file-dropzone';
import { PreviewTable } from '../components/import/preview-table';
import { ColumnMapper, type ColumnMapping } from '../components/import/column-mapper';
import { LoadingSpinner } from '../components/shared/loading-spinner';
import { useFileUpload } from '../hooks/use-file-upload';
import { connectorApi, type UploadedFile } from '../api/connector-api';
import { exportApi } from '../api/export-api';
import { StatusBadge } from '../components/shared/status-badge';

type Stage = 'upload' | 'preview' | 'mapping' | 'exporting' | 'done' | 'error';

export function ImportPage() {
  const [stage, setStage] = useState<Stage>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedMeta, setUploadedMeta] = useState<UploadedFile | null>(null);
  const [previewRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { uploading, progress } = useFileUpload();

  const handleFilesAccepted = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setSelectedFile(file);
    setStage('preview');
    try {
      const meta = await connectorApi.uploadFile(file);
      setUploadedMeta(meta);
      if (meta.columns && meta.columns.length > 0) {
        const initMapping: ColumnMapping = {};
        meta.columns.forEach((c) => {
          initMapping[c] = '';
        });
        setMapping(initMapping);
      } else {
        // Server xử lý đồng bộ (trả resourceCount, không có columns) —
        // import đã xong, chuyển thẳng sang done thay vì kẹt ở preview.
        setStage('done');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setStage('error');
    }
  }, []);

  const handleStartExport = async () => {
    if (!uploadedMeta) return;
    setStage('exporting');
    try {
      const job = await exportApi.startExport({
        connectorType: 'file',
        fileUploadId: uploadedMeta.id,
      });
      setJobId(job.id);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
      setStage('error');
    }
  };

  const handleReset = () => {
    setStage('upload');
    setSelectedFile(null);
    setUploadedMeta(null);
    setMapping({});
    setJobId(null);
    setError(null);
  };

  const columns = uploadedMeta?.columns ?? [];

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

        {/* Stage 2 — Preview */}
        {(stage === 'preview' || stage === 'mapping') && (
          <>
            <FileDropzone
              onFilesAccepted={(files) => void handleFilesAccepted(files)}
              selectedFile={selectedFile}
              onClearFile={handleReset}
            />
            {uploading && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <LoadingSpinner size="sm" />
                <span>Uploading… {progress}%</span>
              </div>
            )}
            {columns.length > 0 && (
              <>
                <div>
                  <h2 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Preview
                  </h2>
                  <PreviewTable columns={columns} rows={previewRows} />
                  {uploadedMeta && (
                    <p className="mt-1 text-xs text-gray-500">
                      {uploadedMeta.rowCount ?? '?'} rows · {columns.length} columns
                    </p>
                  )}
                </div>
                <div>
                  <h2 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Map Columns to FHIR
                  </h2>
                  <ColumnMapper sourceColumns={columns} mapping={mapping} onChange={setMapping} />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleStartExport()}
                    className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                  >
                    Start Import
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {stage === 'exporting' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <LoadingSpinner size="lg" />
            <p className="text-sm text-gray-500">Processing import…</p>
          </div>
        )}

        {stage === 'done' && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-5 dark:border-green-800 dark:bg-green-900/20">
            <p className="font-medium text-green-800 dark:text-green-200">
              {uploadedMeta?.resourceCount != null
                ? `Import complete — ${uploadedMeta.resourceCount} resources processed`
                : 'Import started'}
            </p>
            {selectedFile && (
              <p className="mt-1 text-sm text-green-700 dark:text-green-300">{selectedFile.name}</p>
            )}
            {jobId && (
              <p className="mt-1 text-sm text-green-600">
                Job ID: <StatusBadge status="running" />
              </p>
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
