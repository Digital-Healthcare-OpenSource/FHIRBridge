/**
 * ExportProgress — polls job status and shows a visual step-by-step progress display.
 */

import { useEffect } from 'react';
import { CheckCircle2, Circle, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePolling } from '../../hooks/use-polling';
import { exportApi, type ExportJob } from '../../api/export-api';
import { POLLING_INTERVAL_MS } from '../../lib/constants';
import { useTranslation } from '../../i18n/use-translation';

const STEPS = [
  { key: 'connecting', labelKey: 'progress.step_connecting' },
  { key: 'fetching', labelKey: 'progress.step_fetching' },
  { key: 'mapping', labelKey: 'progress.step_mapping' },
  { key: 'bundling', labelKey: 'progress.step_bundling' },
  { key: 'complete', labelKey: 'progress.step_complete' },
] as const;

function progressToStep(progress: number): number {
  if (progress < 20) return 0;
  if (progress < 40) return 1;
  if (progress < 70) return 2;
  if (progress < 95) return 3;
  return 4;
}

interface Props {
  jobId: string;
  onComplete: (job: ExportJob) => void;
  onError: (message: string) => void;
}

export function ExportProgress({ jobId, onComplete, onError }: Props) {
  const { t } = useTranslation('common');
  const { data: job, error } = usePolling(() => exportApi.getStatus(jobId), {
    interval: POLLING_INTERVAL_MS,
    enabled: true,
    shouldStop: (j) => j.status === 'complete' || j.status === 'error',
  });

  useEffect(() => {
    if (!job) return;
    if (job.status === 'complete') onComplete(job);
    if (job.status === 'error') onError(job.error ?? 'Export failed');
  }, [job, onComplete, onError]);

  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);

  const currentStep = job ? progressToStep(job.progress) : 0;
  const progress = job?.progress ?? 0;

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-gray-500">
          <span>{t('progress.label')}</span>
          <span>{progress}%</span>
        </div>
        <div
          role="progressbar"
          aria-label={t('progress.label')}
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700"
        >
          <div
            className="h-2 rounded-full bg-primary-600 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <ol className="space-y-3">
        {STEPS.map((step, idx) => {
          const done = idx < currentStep;
          const active = idx === currentStep && job?.status !== 'error';
          const isError = job?.status === 'error' && idx === currentStep;
          return (
            <li key={step.key} className="flex items-center gap-3">
              {isError ? (
                <AlertCircle className="h-5 w-5 text-red-500" aria-hidden />
              ) : done ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" aria-hidden />
              ) : active ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary-600" aria-hidden />
              ) : (
                <Circle className="h-5 w-5 text-gray-300 dark:text-gray-600" aria-hidden />
              )}
              <span
                aria-live={active ? 'polite' : undefined}
                className={cn(
                  'text-sm',
                  done
                    ? 'text-green-700 dark:text-green-400'
                    : active
                      ? 'font-medium text-gray-900 dark:text-gray-100'
                      : 'text-gray-400 dark:text-gray-600',
                )}
              >
                {t(step.labelKey)}
              </span>
            </li>
          );
        })}
      </ol>

      {job?.status === 'error' && (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
        >
          {job.error ?? t('progress.error_generic')}
        </p>
      )}
    </div>
  );
}
