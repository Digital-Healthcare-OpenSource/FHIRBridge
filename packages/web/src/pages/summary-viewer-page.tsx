/**
 * SummaryViewerPage — generate and view AI summary for a given export ID.
 *
 * Fix C-14: removed duplicate usePolling call; single poll with:
 *  - correct dependency array (pendingJobId, completedJob)
 *  - 5-minute max polling timeout
 *  - AbortController cleanup on unmount
 *
 * Lỗi hiển thị = tiêu đề đã dịch + message nguyên văn từ server (vd. 503 "AI summaries
 * are not configured…", 502 "Summary generation failed: <reason>"). Poll dừng ở mọi
 * lỗi khác 409 (summaryApi.getStatus trả status 'error' → shouldStop).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Trans } from 'react-i18next';
import { PageContainer } from '../components/layout/page-container';
import {
  SummaryConfig,
  DEFAULT_SUMMARY_PROVIDER,
  defaultSummaryLanguage,
  providerLabel,
  type SummaryConfigValue,
} from '../components/summary/summary-config';
import { SummaryDisplay } from '../components/summary/summary-display';
import { SummaryActions } from '../components/summary/summary-actions';
import { LoadingSpinner } from '../components/shared/loading-spinner';
import { usePolling } from '../hooks/use-polling';
import { summaryApi, type SummaryJob } from '../api/summary-api';
import { ApiError } from '../api/api-client';
import { CrossBorderConsentModal } from '../components/consent';
import { useConsent } from '../hooks/use-consent';
import { BaaDisclaimerModal } from '../components/baa';
import { useBaaAcknowledgment } from '../hooks/use-baa-acknowledgment';
import { useTranslation } from '../i18n/use-translation';

/** Feature flag — AI chỉ bật nếu VITE_AI_ENABLED=true. Hosted SaaS default OFF. */
const AI_FEATURE_ENABLED = import.meta.env.VITE_AI_ENABLED === 'true';

/** Max time to poll before declaring a timeout (5 minutes). */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

type ErrorTitleKey =
  | 'viewer.baa_required'
  | 'viewer.consent_required'
  | 'viewer.error_not_configured'
  | 'viewer.error_start'
  | 'viewer.error_failed'
  | 'viewer.error_timeout';

/** Lưu key (không lưu chuỗi đã dịch) để đổi ngôn ngữ thì tiêu đề lỗi đổi theo. */
interface GenError {
  titleKey: ErrorTitleKey;
  /** Message nguyên văn từ server — không dịch */
  detail?: string;
}

export function SummaryViewerPage() {
  const { id: exportId } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation('summary');
  const [summaryConfig, setSummaryConfig] = useState<SummaryConfigValue>(() => ({
    provider: DEFAULT_SUMMARY_PROVIDER,
    language: defaultSummaryLanguage(i18n.resolvedLanguage),
    detailLevel: 'standard',
  }));
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [completedJob, setCompletedJob] = useState<SummaryJob | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<GenError | null>(null);

  // BAA gate — first-time acknowledgment trước khi gửi data ra AI provider
  const baa = useBaaAcknowledgment();

  // Consent gate — phải đồng ý xử lý dữ liệu xuyên biên giới trước khi gọi AI
  const { hasConsent, requestConsent, modalOpen, handleModalAccept, handleModalDecline } =
    useConsent();

  // Ref tracks when polling started so we can enforce max duration
  const pollStartRef = useRef<number | null>(null);

  // Track poll start time when polling begins
  useEffect(() => {
    if (pendingJobId && !completedJob) {
      pollStartRef.current = Date.now();
    } else {
      pollStartRef.current = null;
    }
  }, [pendingJobId, completedJob]);

  const shouldStopPolling = useCallback((job: SummaryJob): boolean => {
    // 'error' = mọi lỗi khác 409 (vd. 502 generation failed) → dừng poll
    if (job.status === 'complete' || job.status === 'error') return true;
    // Enforce max polling duration
    if (pollStartRef.current != null && Date.now() - pollStartRef.current > POLL_TIMEOUT_MS) {
      return true;
    }
    return false;
  }, []);

  // Single usePolling call — C-14 fix (was duplicated before)
  const { data: polledJob, error: pollError } = usePolling(
    () => summaryApi.getStatus(pendingJobId!),
    {
      interval: 2000,
      enabled: !!pendingJobId && !completedJob,
      shouldStop: shouldStopPolling,
    },
  );

  // Sync polled result into state
  useEffect(() => {
    if (!polledJob) return;
    if (polledJob.status === 'complete') {
      setCompletedJob(polledJob);
      setPendingJobId(null);
    } else if (polledJob.status === 'error') {
      setGenError({ titleKey: 'viewer.error_failed', detail: polledJob.error });
      setPendingJobId(null);
    }
  }, [polledJob]);

  // Handle timeout: polling stopped but job not complete
  useEffect(() => {
    if (!pendingJobId || completedJob || pollStartRef.current == null) return;
    if (Date.now() - pollStartRef.current > POLL_TIMEOUT_MS) {
      setGenError({ titleKey: 'viewer.error_timeout' });
      setPendingJobId(null);
    }
  }, [polledJob, pendingJobId, completedJob]);

  // Surface polling network errors
  useEffect(() => {
    if (pollError) {
      setGenError({ titleKey: 'viewer.error_failed', detail: pollError });
      setPendingJobId(null);
    }
  }, [pollError]);

  const handleGenerate = useCallback(async () => {
    if (!exportId) return;

    // BAA gate (block 1): first-time acknowledgment cho HIPAA disclaimer
    if (!baa.acknowledged) {
      const acked = await baa.requestAcknowledgment();
      if (!acked) {
        setGenError({ titleKey: 'viewer.baa_required' });
        return;
      }
    }

    // Consent gate (block 2): cross-border data processing per request
    if (!hasConsent) {
      const granted = await requestConsent();
      if (!granted) {
        setGenError({ titleKey: 'viewer.consent_required' });
        return;
      }
    }

    setGenerating(true);
    setGenError(null);
    setCompletedJob(null);
    try {
      const job = await summaryApi.generateSummary({ ...summaryConfig, exportId });
      setPendingJobId(job.id);
    } catch (err) {
      // 503 = server chưa cấu hình provider key (ANTHROPIC_API_KEY / OPENAI_API_KEY)
      const notConfigured = err instanceof ApiError && err.status === 503;
      setGenError({
        titleKey: notConfigured ? 'viewer.error_not_configured' : 'viewer.error_start',
        detail: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setGenerating(false);
    }
  }, [exportId, summaryConfig, hasConsent, requestConsent, baa]);

  return (
    <PageContainer
      title={t('viewer.title')}
      description={t('viewer.description')}
      actions={completedJob ? <SummaryActions summaryId={completedJob.id} /> : undefined}
    >
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Config */}
        <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
            {t('viewer.configuration')}
          </h2>
          <SummaryConfig
            value={summaryConfig}
            onChange={setSummaryConfig}
            disabled={generating || !!pendingJobId}
          />
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating || !!pendingJobId || !exportId || !AI_FEATURE_ENABLED}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {generating
                ? t('viewer.starting')
                : pendingJobId
                  ? t('viewer.generating')
                  : t('section.generate_button')}
            </button>
            {pendingJobId && !completedJob && (
              <LoadingSpinner size="sm" label={t('section.loading')} />
            )}
          </div>
          {!AI_FEATURE_ENABLED && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              <Trans t={t} i18nKey="viewer.ai_disabled" components={{ code: <code /> }} />
            </p>
          )}
          {genError && (
            <div
              role="alert"
              className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20"
            >
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                {t(genError.titleKey)}
              </p>
              {genError.detail && (
                <p className="mt-1 break-words text-sm text-red-600 dark:text-red-400">
                  {genError.detail}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Summary output */}
        {completedJob?.content && (
          <div className="rounded-lg border border-gray-200 p-5 dark:border-gray-700">
            <SummaryDisplay content={completedJob.content} />
          </div>
        )}

        {!exportId && (
          <p className="rounded-md bg-yellow-50 p-4 text-sm text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
            {t('viewer.no_export_id')}
          </p>
        )}
      </div>

      {/* BAA disclaimer modal — hiện lần đầu user bật AI summary */}
      <BaaDisclaimerModal baa={baa} />

      {/* Cross-border consent modal — hiện mỗi request AI nếu chưa có consent */}
      <CrossBorderConsentModal
        open={modalOpen}
        providerName={providerLabel(summaryConfig.provider)}
        onAccept={handleModalAccept}
        onDecline={handleModalDecline}
      />
    </PageContainer>
  );
}
