/**
 * BaaDisclaimerModal — modal blocking đầu tiên khi user bật AI Summary.
 *
 * Hiển thị cảnh báo HIPAA/BAA trước khi gửi data ra AI provider:
 * - Anthropic/OpenAI không cấp BAA cho cá nhân/self-host nhỏ
 * - Operator (bệnh viện/phòng khám) tự chịu trách nhiệm nếu là covered entity
 * - Khuyến nghị tự ký BAA riêng nếu xử lý PHI quy mô production
 *
 * A11y: focus trap, keyboard Escape để cancel, aria-modal, aria-labelledby.
 * I18n: strings từ namespace 'baa' qua useTranslation.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, ExternalLink, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { UseBaaAcknowledgmentReturn } from '../../hooks/use-baa-acknowledgment';
import { useTranslation } from '../../i18n/use-translation';

// URL tới tài liệu BAA strategy — không i18n hoá vì là URL kỹ thuật cố định
const BAA_DOCS_URL = 'https://github.com/your-org/fhirbridge/blob/main/docs/baa-strategy.md';

interface Props {
  /** Trạng thái từ useBaaAcknowledgment */
  baa: Pick<UseBaaAcknowledgmentReturn, 'isModalOpen' | 'onConfirm' | 'onCancel'>;
}

export function BaaDisclaimerModal({ baa }: Props) {
  const { t } = useTranslation('baa');
  const [checked, setChecked] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const checkboxRef = useRef<HTMLInputElement>(null);
  // Lưu element đang focus trước khi mở modal để restore khi đóng
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = 'baa-modal-title';
  const descId = 'baa-modal-desc';

  // Reset checkbox mỗi lần modal mở; lưu/khôi phục focus quanh vòng đời modal
  useEffect(() => {
    if (!baa.isModalOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setChecked(false);
    // Focus vào dialog sau khi mount để screen reader thông báo
    requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });

    return () => {
      // Trả focus về trigger khi modal đóng/unmount
      previousFocusRef.current?.focus?.();
    };
  }, [baa.isModalOpen]);

  // Focus trap — giữ focus bên trong modal khi tab
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      baa.onCancel();
      return;
    }

    if (e.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  if (!baa.isModalOpen) return null;

  // Bullets là array trong JSON — t() trả về string, dùng returnObjects để lấy array
  const bullets = t('modal.bullets', { returnObjects: true }) as string[];

  return (
    // Backdrop — KHÔNG đặt aria-hidden ở đây: nó bọc role=dialog nên sẽ ẩn toàn
    // bộ nội dung HIPAA khỏi screen reader. aria-modal trên dialog đã xử lý inert.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        // Click ngoài backdrop KHÔNG đóng modal — user phải chọn rõ ràng
        e.stopPropagation();
      }}
    >
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative w-full max-w-lg rounded-xl bg-white shadow-2xl outline-none',
          'dark:bg-gray-900',
          'max-h-[90vh] overflow-y-auto',
        )}
        // Ngăn click bên trong lan ra backdrop
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-6 py-4 dark:border-amber-800 dark:bg-amber-900/20">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <div className="flex-1">
            <h2 id={titleId} className="text-base font-semibold text-amber-900 dark:text-amber-100">
              {t('modal.title')}
            </h2>
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
              {t('modal.title_sub')}
            </p>
          </div>
          {/* Nút đóng chỉ là cancel — không confirm */}
          <button
            type="button"
            onClick={baa.onCancel}
            aria-label={t('modal.close_aria')}
            className="rounded p-1 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-800/50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5" id={descId}>
          <ul className="space-y-3">
            {bullets.map((bullet, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                {/* Dấu chấm bullet */}
                <span
                  className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500"
                  aria-hidden="true"
                />
                <span>{bullet}</span>
              </li>
            ))}
            {/* Link tài liệu BAA strategy */}
            <li className="flex gap-2.5 text-sm">
              <span
                className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500"
                aria-hidden="true"
              />
              <span className="text-gray-700 dark:text-gray-300">
                {t('modal.docs_link_prefix')}{' '}
                <a
                  href={BAA_DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary-600 underline hover:text-primary-700 dark:text-primary-400"
                >
                  {t('modal.docs_link_label')}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </span>
            </li>
          </ul>

          {/* Checkbox xác nhận */}
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50">
            <input
              ref={checkboxRef}
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer accent-primary-600"
              aria-required="true"
            />
            <span className="text-sm leading-snug text-gray-700 dark:text-gray-300">
              {t('modal.checkbox_label')}
            </span>
          </label>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <button
            type="button"
            onClick={baa.onCancel}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            {t('modal.cancel_button')}
          </button>
          <button
            type="button"
            onClick={baa.onConfirm}
            disabled={!checked}
            aria-disabled={!checked}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium text-white transition-colors',
              checked
                ? 'bg-primary-600 hover:bg-primary-700'
                : 'cursor-not-allowed bg-gray-300 dark:bg-gray-700 dark:text-gray-500',
            )}
          >
            {t('modal.confirm_button')}
          </button>
        </div>
      </div>
    </div>
  );
}
