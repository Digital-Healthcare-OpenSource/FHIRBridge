/**
 * ExportWizardPage — 6-step export flow using useExport state machine.
 */

import { useNavigate } from 'react-router-dom';
import { PageContainer } from '../components/layout/page-container';
import { ConnectorForm } from '../components/export/connector-form';
import { ExportProgress } from '../components/export/export-progress';
import { ExportResult } from '../components/export/export-result';
import { useExport, type ExportStep } from '../hooks/use-export';
import { connectorApi } from '../api/connector-api';
import { cn } from '../lib/utils';
import { ROUTES } from '../lib/constants';
import { useState } from 'react';
import type { ExportJob } from '../api/export-api';
import { useTranslation } from '../i18n/use-translation';

const STEP_KEYS = [
  'wizard.step.connector',
  'wizard.step.configure',
  'wizard.step.patient',
  'wizard.step.options',
  'wizard.step.review',
  'wizard.step.progress',
] as const;

function StepIndicator({ current }: { current: number }) {
  const { t } = useTranslation('common');
  return (
    <nav aria-label={t('wizard.steps_aria')} className="mb-6">
      <ol className="flex items-center gap-0">
        {STEP_KEYS.map((key, idx) => {
          const label = t(key);
          const step = (idx + 1) as ExportStep;
          const done = current > step;
          const active = current === step;
          return (
            <li key={key} className="flex items-center" aria-current={active ? 'step' : undefined}>
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
              {idx < STEP_KEYS.length - 1 && (
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
  const { t } = useTranslation('common');
  const { t: tError } = useTranslation('errors');
  const { flowState, config, updateConfig, goToStep, startExport, reset } = useExport();
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
      setTestResult({ success: false, message: t('connector.test_failed') });
    } finally {
      setTesting(false);
    }
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
    <PageContainer title={t('wizard.title')} description={t('wizard.description')}>
      <div className="mx-auto max-w-2xl">
        <StepIndicator current={step} />

        {/* Step 1 — Select connector type */}
        {flowState.phase === 'configuring' && flowState.step === 1 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
              {t('wizard.select_source')}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['fhir', 'file'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    // Server exports only from FHIR endpoints; CSV / Excel files are
                    // converted on the Import page (column mapping → FHIR bundle).
                    if (type === 'file') {
                      navigate(ROUTES.IMPORT);
                      return;
                    }
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
                    {type === 'fhir'
                      ? t('wizard.source_fhir_title')
                      : t('wizard.source_file_title')}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                    {type === 'fhir' ? t('wizard.source_fhir_desc') : t('wizard.source_file_desc')}
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
              {t('wizard.fhir_connection')}
            </h2>
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
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => goToStep(1)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600"
              >
                {t('action.back')}
              </button>
              <button
                type="button"
                onClick={() => goToStep(3)}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                {t('action.next')}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Patient ID */}
        {flowState.phase === 'configuring' && flowState.step === 3 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
              {t('wizard.patient_id')}
            </h2>
            <div>
              <label
                htmlFor="patient-id"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                {t('wizard.patient_identifier')}
              </label>
              <input
                id="patient-id"
                type="text"
                placeholder={t('wizard.patient_placeholder')}
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
                {t('action.back')}
              </button>
              <button
                type="button"
                onClick={() => goToStep(4)}
                disabled={!config.patientId}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {t('action.next')}
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — Output options */}
        {flowState.phase === 'configuring' && flowState.step === 4 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
              {t('wizard.output_options')}
            </h2>
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="export-format"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  {t('wizard.format')}
                </label>
                <select
                  id="export-format"
                  value={config.format}
                  onChange={(e) => updateConfig({ format: e.target.value as 'json' | 'ndjson' })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="json">{t('wizard.format_json')}</option>
                  <option value="ndjson">{t('wizard.format_ndjson')}</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={config.includeSummary}
                  onChange={(e) => updateConfig({ includeSummary: e.target.checked })}
                  className="rounded border-gray-300"
                />
                {t('wizard.generate_summary')}
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => goToStep(3)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600"
              >
                {t('action.back')}
              </button>
              <button
                type="button"
                onClick={() => goToStep(5)}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                {t('action.next')}
              </button>
            </div>
          </div>
        )}

        {/* Step 5 — Review */}
        {flowState.phase === 'configuring' && flowState.step === 5 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
              {t('wizard.review')}
            </h2>
            <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:border-gray-700 dark:divide-gray-700 text-sm">
              {[
                [t('wizard.review_source'), t('wizard.review_fhir', { url: config.fhirUrl ?? '' })],
                [t('wizard.review_patient'), config.patientId ?? '—'],
                [t('wizard.review_format'), config.format.toUpperCase()],
                [
                  t('wizard.review_summary'),
                  config.includeSummary ? t('wizard.yes') : t('wizard.no'),
                ],
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
                {t('action.back')}
              </button>
              <button
                type="button"
                onClick={() => void handleStartExport()}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                {t('wizard.start_export')}
              </button>
            </div>
          </div>
        )}

        {/* Step 6 — Progress / Result */}
        {flowState.phase === 'exporting' && (
          <div className="space-y-4">
            {!completedJob && !exportError && (
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                {t('wizard.exporting')}
              </h2>
            )}
            <ExportProgress
              jobId={flowState.jobId}
              onComplete={(job) => setCompletedJob(job)}
              onError={(msg) => setExportError(msg)}
            />
          </div>
        )}

        {completedJob && <ExportResult job={completedJob} className="mt-4" />}

        {exportError && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
          >
            {exportError}
          </p>
        )}

        {/* startExport bị từ chối (vd. 401 chưa đăng nhập) — trước đây trang trắng */}
        {flowState.phase === 'error' && (
          <div
            role="alert"
            className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
          >
            <p className="font-medium">{tError('export_failed')}</p>
            {flowState.message && flowState.message !== tError('export_failed') && (
              <p className="mt-1 break-words">{flowState.message}</p>
            )}
          </div>
        )}

        {(completedJob || exportError || flowState.phase === 'error') && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                reset();
                navigate(ROUTES.DASHBOARD);
              }}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600"
            >
              {t('wizard.back_to_dashboard')}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                goToStep(1);
              }}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              {t('wizard.new_export')}
            </button>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
