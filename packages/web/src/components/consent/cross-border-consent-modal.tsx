/**
 * CrossBorderConsentModal — hiển thị trước mỗi AI summary call.
 * Compliance: GDPR Art.49 / PDPL / APPI — thông báo xử lý dữ liệu xuyên biên giới.
 *
 * Không dùng Radix Dialog để tránh thêm dependency; dùng div+overlay với
 * focus trap thủ công, aria-modal, aria-labelledby.
 *
 * I18n: strings từ namespace 'consent' qua useTranslation.
 */

import { useEffect, useRef, useCallback, type KeyboardEvent } from 'react';
import { useTranslation } from '../../i18n/use-translation';

// URL tới docs self-hosted LLM — không i18n hoá vì là URL kỹ thuật cố định
const SELF_HOST_URL = 'https://github.com/your-org/fhirbridge/blob/main/docs/deployment-guide.md';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface CrossBorderConsentModalProps {
  /** Tên provider AI được chọn, ví dụ "Claude (Anthropic)" */
  providerName: string;
  /** Callback khi user click "Đồng ý và tiếp tục" */
  onAccept: (rememberSession: boolean) => void;
  /** Callback khi user click "Từ chối" hoặc đóng modal */
  onDecline: () => void;
  /** Có đang hiển thị không */
  open: boolean;
}

export function CrossBorderConsentModal({
  providerName,
  onAccept,
  onDecline,
  open,
}: CrossBorderConsentModalProps) {
  const { t } = useTranslation('consent');

  // ref cho checkbox "nhớ lựa chọn"
  const rememberRef = useRef<HTMLInputElement>(null);
  // ref cho button đầu tiên để set focus khi mở
  const acceptBtnRef = useRef<HTMLButtonElement>(null);
  // ref cho toàn bộ modal container để focus trap
  const modalRef = useRef<HTMLDivElement>(null);

  // Khi modal mở, focus vào nút Đồng ý
  useEffect(() => {
    if (!open) return;
    // Delay nhỏ để DOM render xong
    const id = setTimeout(() => acceptBtnRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [open]);

  // ESC → decline
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onDecline();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onDecline]);

  // Focus trap: Tab / Shift+Tab giữ focus trong modal
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
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
  }, []);

  const handleAccept = useCallback(() => {
    const remember = rememberRef.current?.checked ?? false;
    onAccept(remember);
  }, [onAccept]);

  if (!open) return null;

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      aria-hidden="false"
      onClick={(e) => {
        // Click ngoài modal → decline
        if (e.target === e.currentTarget) onDecline();
      }}
    >
      {/* Dialog panel */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cbcm-title"
        className="relative w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl dark:bg-gray-900"
        style={{ maxHeight: '90vh' }}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <h2
            id="cbcm-title"
            className="text-base font-semibold leading-snug text-gray-900 dark:text-gray-100"
          >
            {t('modal.title')}
          </h2>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5 text-sm text-gray-700 dark:text-gray-300">
          {/* Destination */}
          <InfoRow label={t('modal.destination_label')} value={t('modal.destination_value')} />

          {/* Provider — dynamic từ props + contact (PIPA mục 3: bên nhận + contact) */}
          <InfoRow
            label={t('modal.provider_label')}
            value={`${providerName} — ${t('modal.provider_contact_value')}`}
          />

          {/* Purpose (PIPA mục 4a: mục đích sử dụng của bên nhận) */}
          <InfoRow label={t('modal.purpose_label')} value={t('modal.purpose_value')} />

          {/* Data transferred */}
          <InfoRow label={t('modal.data_label')} value={t('modal.data_value')} />

          {/* Retention */}
          <InfoRow label={t('modal.retention_label')} value={t('modal.retention_value')} />

          {/* Rights */}
          <div>
            <dt className="mb-0.5 font-medium text-gray-900 dark:text-gray-100">
              {t('modal.rights_label')}
            </dt>
            <dd className="leading-relaxed">
              {t('modal.rights_value')}{' '}
              <a
                href={SELF_HOST_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 underline hover:text-primary-700 dark:text-primary-400"
              >
                {t('modal.self_host_link')}
              </a>
            </dd>
          </div>

          {/* Remember checkbox */}
          <label className="flex cursor-pointer items-center gap-2 pt-1">
            <input
              ref={rememberRef}
              type="checkbox"
              defaultChecked={false}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span>{t('modal.remember_label')}</span>
          </label>
        </div>

        {/* Footer buttons */}
        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <button
            type="button"
            onClick={onDecline}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {t('modal.decline_button')}
          </button>
          <button
            ref={acceptBtnRef}
            type="button"
            onClick={handleAccept}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          >
            {t('modal.accept_button')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: một hàng thông tin label / value
// ---------------------------------------------------------------------------
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <dl>
      <dt className="mb-0.5 font-medium text-gray-900 dark:text-gray-100">{label}</dt>
      <dd className="leading-relaxed">{value}</dd>
    </dl>
  );
}
