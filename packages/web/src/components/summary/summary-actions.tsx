/**
 * SummaryActions — download button for a completed summary.
 * Uses Toast instead of native alert() for error feedback (H-13 fix).
 * Server chỉ hỗ trợ Markdown (không có PDF) — nên chỉ có MỘT nút, nhãn trung thực.
 */

import { useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import { summaryApi } from '../../api/summary-api';
import { Toast, type ToastState } from '../ui/toast';
import { useTranslation } from '../../i18n/use-translation';

interface Props {
  summaryId: string;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SummaryActions({ summaryId }: Props) {
  const { t } = useTranslation('summary');
  const { t: tError } = useTranslation('errors');
  const [toast, setToast] = useState<ToastState | null>(null);

  const downloadMarkdown = useCallback(async () => {
    try {
      const blob = await summaryApi.downloadMarkdown(summaryId);
      triggerDownload(blob, `summary-${summaryId}.md`);
    } catch {
      setToast({ message: tError('markdown_download_failed'), variant: 'error' });
    }
  }, [summaryId, tError]);

  return (
    <>
      <Toast state={toast} onClose={() => setToast(null)} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void downloadMarkdown()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
        >
          <Download className="h-4 w-4" aria-hidden />
          {t('actions.download_markdown')}
        </button>
      </div>
    </>
  );
}
