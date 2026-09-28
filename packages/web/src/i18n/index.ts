/**
 * i18n setup — i18next + react-i18next + browser language detector.
 *
 * Chiến lược:
 * - Cả 4 locale (VI / EN / JA / KO) loaded eagerly — payload nhỏ, tránh async gap
 * - Detect order: localStorage (key 'fhirbridge.lang') → navigator → fallback 'en'
 *   (trình duyệt fr, zh, … ngoài 4 locale → tiếng Anh, mặc định quốc tế)
 * - Namespace per file: common | consent | baa | summary | errors | landing
 * - <html lang> luôn đồng bộ với ngôn ngữ hiện tại (screen reader + glyph CJK)
 *
 * JA + KO: đã có bản dịch thật (không còn placeholder tiếng Việt như trước).
 * Nội dung pháp lý (namespace consent + baa) VẪN CHƯA qua native-speaker review
 * — thuật ngữ APPI/PIPA đã cố tình chọn cách dịch trung tính, xem checklist
 * trong PR giới thiệu 2 locale này.
 *
 * Quy tắc giữ nguyên: KHÔNG expose một locale trong SUPPORTED_LANGUAGES khi nội
 * dung của nó còn là placeholder — hiển thị nhãn 한국어/日本語 mà ruột là ngôn ngữ
 * khác sẽ đánh lừa clinician. Parity key giữa 4 locale được test
 * i18n/__tests__/locale-parity.test.ts canh giữ.
 */

import i18n, { type InitOptions } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// ---------------------------------------------------------------------------
// VI bundles
// ---------------------------------------------------------------------------
import viCommon from './locales/vi/common.json';
import viConsent from './locales/vi/consent.json';
import viBaa from './locales/vi/baa.json';
import viSummary from './locales/vi/summary.json';
import viErrors from './locales/vi/errors.json';
import viLanding from './locales/vi/landing.json';

// ---------------------------------------------------------------------------
// EN bundles — fallback language
// ---------------------------------------------------------------------------
import enCommon from './locales/en/common.json';
import enConsent from './locales/en/consent.json';
import enBaa from './locales/en/baa.json';
import enSummary from './locales/en/summary.json';
import enErrors from './locales/en/errors.json';
import enLanding from './locales/en/landing.json';

// ---------------------------------------------------------------------------
// JA bundles — thị trường Nhật Bản
// ---------------------------------------------------------------------------
import jaCommon from './locales/ja/common.json';
import jaConsent from './locales/ja/consent.json';
import jaBaa from './locales/ja/baa.json';
import jaSummary from './locales/ja/summary.json';
import jaErrors from './locales/ja/errors.json';
import jaLanding from './locales/ja/landing.json';

// ---------------------------------------------------------------------------
// KO bundles — thị trường Hàn Quốc
// ---------------------------------------------------------------------------
import koCommon from './locales/ko/common.json';
import koConsent from './locales/ko/consent.json';
import koBaa from './locales/ko/baa.json';
import koSummary from './locales/ko/summary.json';
import koErrors from './locales/ko/errors.json';
import koLanding from './locales/ko/landing.json';

// ---------------------------------------------------------------------------
// Supported locales — 4 thị trường: Global / Việt Nam / Nhật Bản / Hàn Quốc
// ---------------------------------------------------------------------------
export const SUPPORTED_LANGUAGES = ['vi', 'en', 'ja', 'ko'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Ngôn ngữ fallback khi trình duyệt dùng locale không hỗ trợ. */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

/** Nhãn bản ngữ — KHÔNG dịch (người dùng tìm ngôn ngữ của mình theo tên bản ngữ). */
export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
};

export const NAMESPACES = ['common', 'consent', 'baa', 'summary', 'errors', 'landing'] as const;

export function isSupportedLanguage(lng: unknown): lng is SupportedLanguage {
  return typeof lng === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(lng);
}

/** Chuẩn hoá mã ngôn ngữ ('ja-JP' → 'ja'); ngoài 4 locale → DEFAULT_LANGUAGE. */
export function toSupportedLanguage(lng: string | null | undefined): SupportedLanguage {
  const base = (lng ?? '').toLowerCase().split('-')[0];
  return isSupportedLanguage(base) ? base : DEFAULT_LANGUAGE;
}

export const resources = {
  vi: {
    common: viCommon,
    consent: viConsent,
    baa: viBaa,
    summary: viSummary,
    errors: viErrors,
    landing: viLanding,
  },
  en: {
    common: enCommon,
    consent: enConsent,
    baa: enBaa,
    summary: enSummary,
    errors: enErrors,
    landing: enLanding,
  },
  ja: {
    common: jaCommon,
    consent: jaConsent,
    baa: jaBaa,
    summary: jaSummary,
    errors: jaErrors,
    landing: jaLanding,
  },
  ko: {
    common: koCommon,
    consent: koConsent,
    baa: koBaa,
    summary: koSummary,
    errors: koErrors,
    landing: koLanding,
  },
};

/** Init options — export để test dựng instance riêng (kiểm tra detect/fallback). */
export const i18nOptions: InitOptions = {
  detection: {
    order: ['localStorage', 'navigator'],
    caches: ['localStorage'],
    lookupLocalStorage: 'fhirbridge.lang',
  },

  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],

  defaultNS: 'common',
  ns: [...NAMESPACES],

  resources,

  interpolation: {
    // React đã escape — không cần i18next escape thêm
    escapeValue: false,
  },

  // Không suspense — resources đã bundled sẵn
  react: {
    useSuspense: false,
  },
};

/** Đồng bộ <html lang> — screen reader đọc đúng giọng, trình duyệt chọn đúng glyph CJK. */
function syncDocumentLang(lng: string | undefined): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = toSupportedLanguage(lng);
}

// Đăng ký trước init để bắt cả sự kiện languageChanged đầu tiên
i18n.on('languageChanged', syncDocumentLang);

void i18n.use(LanguageDetector).use(initReactI18next).init(i18nOptions);

syncDocumentLang(i18n.resolvedLanguage ?? i18n.language);

export default i18n;
