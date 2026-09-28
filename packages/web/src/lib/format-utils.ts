/**
 * Formatting utilities — date, number, file size, resource type, patient ID masking.
 *
 * Date/number dùng Intl theo ngôn ngữ UI hiện tại (i18n.resolvedLanguage) —
 * không hardcode 'en-US'. Truyền `locale` tường minh khi cần kết quả cố định.
 */

import i18n, { toSupportedLanguage } from '../i18n';

/** Locale Intl của UI hiện tại ('vi' | 'en' | 'ja' | 'ko'). */
export function currentLocale(): string {
  return toSupportedLanguage(i18n.resolvedLanguage ?? i18n.language);
}

/** Format ISO date string to a localized date + time. */
export function formatDate(iso: string, locale: string = currentLocale()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return i18n.t('format.invalid_date', { lng: locale });
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Format a number with locale grouping/decimal separators. */
export function formatNumber(
  value: number,
  locale: string = currentLocale(),
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/** Format bytes to human-readable string (units are SI-neutral: B, KB, MB, GB). */
export function formatFileSize(bytes: number, locale: string = currentLocale()): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = formatNumber(bytes / Math.pow(k, i), locale, { maximumFractionDigits: 1 });
  return `${value} ${sizes[i]}`;
}

/** Mask patient ID — show only last 4 characters. */
export function maskPatientId(id: string): string {
  if (id.length <= 4) return '****';
  return `****${id.slice(-4)}`;
}

/** Capitalise first letter of resource type. */
export function formatResourceType(type: string): string {
  if (!type) return '';
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

/** Localized "N resources" with correct plural rules for the active language. */
export function formatResourceCount(count: number, locale: string = currentLocale()): string {
  return i18n.t('format.resource_count', { count, lng: locale });
}

/** Convert snake_case status to Title Case for display. */
export function formatStatus(status: string): string {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
