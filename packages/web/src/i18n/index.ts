/**
 * i18n setup — i18next + react-i18next + browser language detector.
 *
 * Chiến lược:
 * - VI loaded eagerly (default locale)
 * - EN loaded eagerly alongside VI
 * - Detect order: localStorage → navigator → 'vi' fallback
 * - Namespace per file: common | consent | baa | summary | errors
 *
 * JA: các file locales/ja/*.json hiện là placeholder (text tiếng Việt), CHƯA
 * dịch. Không expose 'ja' trong SUPPORTED_LANGUAGES cho tới khi có bản dịch thật
 * — không fabricate nội dung y tế tiếng Nhật. Giữ file JSON lại cho v1.1.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// ---------------------------------------------------------------------------
// VI bundles — loaded eagerly so first paint has no flicker
// ---------------------------------------------------------------------------
import viCommon from './locales/vi/common.json';
import viConsent from './locales/vi/consent.json';
import viBaa from './locales/vi/baa.json';
import viSummary from './locales/vi/summary.json';
import viErrors from './locales/vi/errors.json';

// ---------------------------------------------------------------------------
// EN bundles — loaded eagerly alongside VI (small payload, avoids async gap)
// ---------------------------------------------------------------------------
import enCommon from './locales/en/common.json';
import enConsent from './locales/en/consent.json';
import enBaa from './locales/en/baa.json';
import enSummary from './locales/en/summary.json';
import enErrors from './locales/en/errors.json';

// ---------------------------------------------------------------------------
// Supported locales
// JA cố tình bị loại — locales/ja/*.json vẫn là placeholder tiếng Việt.
// ---------------------------------------------------------------------------
export const SUPPORTED_LANGUAGES = ['vi', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Detect order: localStorage key 'i18nextLng' → browser navigator → fallback
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'fhirbridge.lang',
    },

    fallbackLng: 'vi',
    supportedLngs: SUPPORTED_LANGUAGES,

    defaultNS: 'common',
    ns: ['common', 'consent', 'baa', 'summary', 'errors'],

    resources: {
      vi: {
        common: viCommon,
        consent: viConsent,
        baa: viBaa,
        summary: viSummary,
        errors: viErrors,
      },
      en: {
        common: enCommon,
        consent: enConsent,
        baa: enBaa,
        summary: enSummary,
        errors: enErrors,
      },
    },

    interpolation: {
      // React đã escape — không cần i18next escape thêm
      escapeValue: false,
    },

    // Không suspense — resources đã bundled sẵn
    react: {
      useSuspense: false,
    },
  });

export default i18n;
