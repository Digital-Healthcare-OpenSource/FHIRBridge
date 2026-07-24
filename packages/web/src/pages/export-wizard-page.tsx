/**
 * ExportWizardPage — 6-step export flow using useExport state machine.
 */

import { useNavigate } from 'react-router-dom';
import { PageContainer } from '../components/layout/page-container';
import { ConnectorForm } from '../components/export/connector-form';
import { ExportProgress } from '../components/export/export-progress';
import { ExportResult } from '../components/export/export-result';
import { FileDropzone } from '../components/import/file-dropzone';
import { useExport, type ExportStep } from '../hooks/use-export';
import { useFileUpload } from '../hooks/use-file-upload';
import { connectorApi } from '../api/connector-api';
import { cn } from '../lib/utils';
import { ROUTES } from '../lib/constants';
import { useState } from 'react';
import type { ExportJob } from '../api/export-api';

const STEP_LABELS = ['Connector', 'Configure', 'Patient', 'Options', 'Review', 'Progress'] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <nav aria-label="Export wizard steps" className="mb-6">
      <ol className="flex items-center gap-0">
        {STEP_LABELS.map((label, idx) => {
          const step = (idx + 1) as ExportStep;
          const done = current > step;
          const active = current === step;
          return (
            <li key={label} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
                    done
                      ? 'bg-primary-600 text-white'
                      : active
                        ? 'border-2 border-primary-600 text-primary-600'
                        : 'border-2 border-gray-300 text-gray-400',
                  )}
                >
                  {done ? '✓' : idx + 1}
                </div>
                <span className="mt-1 text-xs text-gray-500 hidden sm:block">{label}</span>
              </div>
              {idx < STEP_LABELS.length - 1 && (
                <div className={cn('h-0.5 w-8 sm:w-12', done ? 'bg-primary-600' : 'bg-gray-200')} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function ExportWizardPage() {
  const navigate = useNavigate();
  const { flowState, config, updateConfig, goToStep, startExport, reset } = useExport();
  const { upload, uploading, progress: uploadProgress } = useFileUpload();
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [completedJob, setCompletedJob] = useState<ExportJob | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const step =
    flowState.phase === 'configuring' ? flowState.step : flowState.phase === 'exporting' ? 6 : 1;

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const result = await connectorApi.testConnection(
        config.fhirUrl ?? '',
        config.clientId,
        config.clientSecret,
      );
      setTestResult(result);
    } catch {
      setTestResult({ success: false, message: 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleFileUpload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    // /api/v1/connectors/import — multipart CSV/FHIR upload
    const uploaded = await upload<{ id: string }>('/v1/connectors/import', file);
    if (uploaded) updateConfig({ fileUploadId: uploaded.id });
  };

  const handleStartExport = async () => {
    goToStep(6);
    await startExport();
  };

  if (flowState.phase === 'idle') {
    goToStep(1);
    return null;
  }

  return (
    <PageContainer title="Export FHIR Bundle" description="Follow the steps to export patient data">
      <div className="mx-auto max-w-2xl">
        <StepIndicator current={step} />

        {/* Step 1 — Select connector type */}
        {flowState.phase === 'configuring' && flowState.step === 1 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
              Select data source
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['fhir', 'file'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    updateConfig({ connectorType: type });
                    goToStep(2);
                  }}
                  className={cn(
                    'rounded-lg border p-4 text-left transition-colors',
                    config.connectorType === type
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 hover:border-primary-300 dark:border-gray-700',
                  )}
                >
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    {type === 'fhir' ? 'FHIR Endpoint' : 'File Upload'}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                    {type === 'fhir'
                      ? 'Connect to a FHIR R4 server'
                      : 'Upload CSV, XLSX or FHIR JSON'}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — Configure */}
        {flowState.phase === 'configuring' && flowState.step === 2 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
              {config.connectorType === 'fhir' ? 'FHIR Connection' : 'Upload File'}
            </h2>
            {config.connectorType === 'fhir' ? (
              <ConnectorForm
                value={{
                  url: config.fhirUrl ?? '',
                  clientId: config.clientId ?? '',
                  clientSecret: config.clientSecret ?? '',
                }}
                onChange={(v) =>
                  updateConfig({
                    fhirUrl: v.url,
                    clientId: v.clientId,
                    clientSecret: v.clientSecret,
                  })
                }
                onTest={() => void handleTestConnection()}
                testResult={testResult}
                testing={testing}
              />
            ) : (
              <div className="space-y-3">
                <FileDropzone
                  onFilesAccepted={(files) => void handleFileUpload(files)}
                  disabled={uploading}
                />
                {uploading && <p className="text-sm text-gray-500">Uploading… {uploadProgress}%</p>}
                {config.fileUploadId && (
                  <p className="text-sm text-green-600">File uploaded successfully.</p>
                )}
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => goToStep(1)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => goToStep(3)}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Patient ID */}
        {flowState.phase === 'configuring' && flowState.step === 3 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Patient ID</h2>
            <div>
              <label
                htmlFor="patient-id"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Patient identifier
              </label>
              <input
                id="patient-id"
                type="text"
                placeholder="e.g. patient-123"
                value={config.patientId ?? ''}
                onChange={(e) => updateConfig({ patientId: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => goToStep(2)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => goToStep(4)}
                disabled={!config.patientId}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — Output options */}
        {flowState.phase === 'configuring' && flowState.step === 4 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
              Output Options
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Format
                </label>
                <select
                  value={config.format}
                  onChange={(e) => updateConfig({ format: e.target.value as 'json' | 'ndjson' })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="json">FHIR Bundle JSON</option>
                  <option value="ndjson">NDJSON</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={config.includeSummary}
                  onChange={(e) => updateConfig({ includeSummary: e.target.checked })}
                  className="rounded border-gray-300"
                />
                Generate AI summary after export
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => goToStep(3)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => goToStep(5)}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 5 — Review */}
        {flowState.phase === 'configuring' && flowState.step === 5 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Review</h2>
            <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:border-gray-700 dark:divide-gray-700 text-sm">
              {[
                [
                  'Source',
                  config.connectorType === 'fhir' ? `FHIR: ${config.fhirUrl}` : 'File upload',
                ],
                ['Patient ID', config.patientId ?? '—'],
                ['Format', config.format.toUpperCase()],
                ['Include summary', config.includeSummary ? 'Yes' : 'No'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between px-4 py-2">
                  <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                  <dd className="font-medium text-gray-800 dark:text-gray-200 break-all max-w-[60%] text-right">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => goToStep(4)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleStartExport()}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                Start Export
              </button>
            </div>
          </div>
        )}

        {/* Step 6 — Progress / Result */}
        {flowState.phase === 'exporting' && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Exporting…</h2>
            <ExportProgress
              jobId={flowState.jobId}
              onComplete={(job) => setCompletedJob(job)}
              onError={(msg) => setExportError(msg)}
            />
          </div>
        )}

        {completedJob && <ExportResult job={completedJob} className="mt-4" />}

        {exportError && (
          <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {exportError}
          </p>
        )}

        {(completedJob || exportError) && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                reset();
                navigate(ROUTES.DASHBOARD);
              }}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600"
            >
              Back to Dashboard
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                goToStep(1);
              }}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              New Export
            </button>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
