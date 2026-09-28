/**
 * ImportPage — CSV / Excel + column mapping → FHIR R4 Bundle.
 *
 * Server /connectors/import xử lý ĐỒNG BỘ: một request multipart (`file` +
 * `mapping`) trả {resourceCount, warnings, bundle} ngay. UI: chọn mapping (mẫu
 * VN / KR / JP / quốc tế hoặc file JSON riêng) + file dữ liệu → import → tải
 * bundle về. Bundle chỉ nằm trong bộ nhớ tab (zero-persistence).
 */

import { useState, useCallback, useEffect } from 'react';
import { Download, FileJson } from 'lucide-react';
import { PageContainer } from '../components/layout/page-container';
import { FileDropzone } from '../components/import/file-dropzone';
import { LoadingSpinner } from '../components/shared/loading-spinner';
import { ApiError } from '../api/api-client';
import { connectorApi, type ImportResult } from '../api/connector-api';
import { useTranslation } from '../i18n/use-translation';
import {
  IMPORT_PRESETS,
  defaultPresetFor,
  loadSampleFile,
  type PresetId,
} from '../lib/import-presets';
import { MAPPING_DOCS_URL } from '../lib/constants';

type Stage = 'upload' | 'importing' | 'done' | 'error';
type MappingChoice = PresetId | 'custom';

const FIELD_CLASS =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
const LABEL_CLASS = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

/** Server warnings arrive on success and on 422 (no resources produced). */
function warningsFrom(value: unknown): string[] {
  const list = (value as { warnings?: unknown } | null)?.warnings;
  return Array.isArray(list) ? list.map(String) : [];
}

/** Read a small text file (FileReader: broadest browser support). */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

function downloadBundle(bundle: unknown): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'fhir-bundle-import.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

function WarningList({ warnings, title }: { warnings: string[]; title: string }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {warnings.map((warning, i) => (
          <li key={i}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

export function ImportPage() {
  const { t, i18n } = useTranslation('common');
  const { t: tError } = useTranslation('errors');
  const [stage, setStage] = useState<Stage>('upload');
  const [choice, setChoice] = useState<MappingChoice>(() =>
    defaultPresetFor(i18n.resolvedLanguage),
  );
  const [customMapping, setCustomMapping] = useState<{ name: string; text: string } | null>(null);
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorWarnings, setErrorWarnings] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);

  const preset = IMPORT_PRESETS.find((p) => p.id === choice);

  // Clear the validation message as soon as the user changes an input.
  useEffect(() => setFormError(null), [choice, dataFile, customMapping]);

  const handleCustomMapping = async (file: File | undefined) => {
    if (!file) return;
    setCustomMapping({ name: file.name, text: await readText(file) });
  };

  const handleUseSample = async () => {
    if (!preset) return;
    setLoadingSample(true);
    try {
      setDataFile(await loadSampleFile(preset));
    } catch {
      setFormError(t('import.sample_failed'));
    } finally {
      setLoadingSample(false);
    }
  };

  const handleImport = useCallback(async () => {
    const mapping = choice === 'custom' ? customMapping?.text : preset?.mapping;
    if (!mapping) return setFormError(t('import.mapping_required'));
    if (!dataFile) return setFormError(t('import.file_required'));
    try {
      JSON.parse(mapping);
    } catch {
      return setFormError(t('import.mapping_invalid_json'));
    }

    setStage('importing');
    try {
      setResult(await connectorApi.importFile(dataFile, mapping));
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : tError('import_failed'));
      setErrorWarnings(err instanceof ApiError ? warningsFrom(err.body) : []);
      setStage('error');
    }
  }, [choice, customMapping, preset, dataFile, t, tError]);

  const handleReset = () => {
    setStage('upload');
    setDataFile(null);
    setResult(null);
    setError(null);
    setErrorWarnings([]);
  };

  return (
    <PageContainer title={t('import.title')} description={t('import.description')}>
      <div className="mx-auto max-w-3xl space-y-6">
        {stage === 'upload' && (
          <div className="space-y-5">
            {/* 1 — Column mapping */}
            <div>
              <label htmlFor="mapping-preset" className={LABEL_CLASS}>
                {t('import.mapping_label')}
              </label>
              <select
                id="mapping-preset"
                value={choice}
                onChange={(e) => setChoice(e.target.value as MappingChoice)}
                className={FIELD_CLASS}
              >
                {IMPORT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t(p.labelKey)}
                  </option>
                ))}
                <option value="custom">{t('import.preset.custom')}</option>
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('import.mapping_help')}{' '}
                <a
                  href={MAPPING_DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 underline hover:text-primary-700"
                >
                  {t('import.mapping_docs')}
                </a>
              </p>
              {choice === 'custom' && (
                <div className="mt-3">
                  <label htmlFor="mapping-file" className={LABEL_CLASS}>
                    {t('import.mapping_file_label')}
                  </label>
                  <input
                    id="mapping-file"
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => void handleCustomMapping(e.target.files?.[0])}
                    className="block w-full text-sm text-gray-700 dark:text-gray-300"
                  />
                  {customMapping && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                      <FileJson className="h-3.5 w-3.5" aria-hidden /> {customMapping.name}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 2 — Data file */}
            <div>
              <p className={LABEL_CLASS}>{t('import.data_file_label')}</p>
              <FileDropzone
                onFilesAccepted={(files) => setDataFile(files[0] ?? null)}
                selectedFile={dataFile}
              />
              {preset && (
                <button
                  type="button"
                  onClick={() => void handleUseSample()}
                  disabled={loadingSample}
                  className="mt-2 text-sm text-primary-600 underline hover:text-primary-700 disabled:opacity-50"
                >
                  {t('import.use_sample', { file: preset.sample.name })}
                </button>
              )}
            </div>

            {formError && (
              <p role="alert" className="text-sm text-red-600">
                {formError}
              </p>
            )}

            <button
              type="button"
              onClick={() => void handleImport()}
              className="rounded-md bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              {t('import.start')}
            </button>
          </div>
        )}

        {/* Importing (server xử lý đồng bộ) */}
        {stage === 'importing' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <LoadingSpinner size="lg" />
            <p className="text-sm text-gray-500">{t('import.processing')}</p>
            {dataFile && <p className="text-xs text-gray-400">{dataFile.name}</p>}
          </div>
        )}

        {/* Done */}
        {stage === 'done' && (
          <div
            role="status"
            className="rounded-lg border border-green-200 bg-green-50 p-5 dark:border-green-800 dark:bg-green-900/20"
          >
            <p className="font-medium text-green-800 dark:text-green-200">
              {result?.resourceCount != null
                ? t('import.complete_count', { count: result.resourceCount })
                : t('import.complete')}
            </p>
            {dataFile && (
              <p className="mt-1 text-sm text-green-700 dark:text-green-300">{dataFile.name}</p>
            )}
            <WarningList warnings={warningsFrom(result)} title={t('import.warnings_title')} />
            <div className="mt-3 flex flex-wrap gap-2">
              {result?.bundle !== undefined && (
                <button
                  type="button"
                  onClick={() => downloadBundle(result.bundle)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800"
                >
                  <Download className="h-4 w-4" aria-hidden />
                  {t('import.download_bundle')}
                </button>
              )}
              <button
                type="button"
                onClick={handleReset}
                className="rounded-md border border-green-300 px-3 py-1.5 text-sm text-green-800 hover:bg-green-100 dark:text-green-200"
              >
                {t('import.import_another')}
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {stage === 'error' && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-900/20"
          >
            <p className="font-medium text-red-700 dark:text-red-300">{t('import.failed')}</p>
            <p className="mt-1 text-sm text-red-600">{error}</p>
            <WarningList warnings={errorWarnings} title={t('import.warnings_title')} />
            <button
              type="button"
              onClick={handleReset}
              className="mt-3 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
            >
              {t('action.try_again')}
            </button>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
