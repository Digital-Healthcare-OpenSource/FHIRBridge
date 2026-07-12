/**
 * ExportResult — bundle preview and download buttons after successful export.
 */

import { useState, useCallback } from 'react';
import { Download, FileJson } from 'lucide-react';
import { cn } from '../../lib/utils';
import { exportApi, type ExportJob } from '../../api/export-api';
import { formatCount, maskPatientId, formatDate } from '../../lib/format-utils';
import { Toast, type ToastState } from '../ui/toast';
import { useTranslation } from '../../i18n/use-translation';

interface Props {
  job: ExportJob;
  className?: string;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportResult({ job, className }: Props) {
  const { t } = useTranslation('common');
  const { t: tError } = useTranslation('errors');
  const [toast, setToast] = useState<ToastState | null>(null);

  const handleDownload = useCallback(async () => {
    try {
      const blob = await exportApi.downloadBundle(job.id);
      downloadBlob(blob, `fhir-bundle-${job.id}.json`);
    } catch {
      setToast({ message: tError('download_failed'), variant: 'error' });
    }
  }, [job.id, tError]);

  return (
    <>
      <Toast state={toast} onClose={() => setToast(null)} />
      <div
        className={cn(
          'rounded-lg border border-green-200 bg-green-50 p-5 dark:border-green-800 dark:bg-green-900/20',
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <FileJson
            className="h-6 w-6 flex-shrink-0 text-green-600 dark:text-green-400 mt-0.5"
            aria-hidden
          />
          <div className="flex-1 space-y-1">
            <p className="font-medium text-green-800 dark:text-green-200">
              {t('export_result.complete')}
            </p>
            <p className="text-sm text-green-700 dark:text-green-300">
              {t('export_result.patient_id_label')}: {maskPatientId(job.patientId ?? '')} ·{' '}
              {formatCount(job.resourceCount, 'resource')} · {formatDate(job.updatedAt ?? '')}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleDownload()}
            className="inline-flex items-center gap-1.5 rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800 dark:bg-green-600 dark:hover:bg-green-700"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t('export_result.download')}
          </button>
        </div>
      </div>
    </>
  );
}
