/**
 * i18n setup — i18next + react-i18next + browser language detector.
 *
 * Chiến lược:
 * - Cả 4 locale (VI / EN / JA / KO) loaded eagerly — payload nhỏ, tránh async gap
 * - Detect order: localStorage → navigator → 'vi' fallback
 * - Namespace per file: common | consent | baa | summary | errors
 *
 * JA + KO: đã có bản dịch thật (không còn placeholder tiếng Việt như trước).
 * Nội dung pháp lý (namespace consent + baa) VẪN CHƯA qua native-speaker review
 * — thuật ngữ APPI/PIPA đã cố tình chọn cách dịch trung tính, xem checklist
 * trong PR giới thiệu 2 locale này.
 *
 * Quy tắc giữ nguyên: KHÔNG expose một locale trong SUPPORTED_LANGUAGES khi nội
 * dung của nó còn là placeholder — hiển thị nhãn 한국어/日本語 mà ruột là ngôn ngữ
 * khác sẽ đánh lừa clinician.
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
// JA bundles — bản dịch thật (thị trường Nhật Bản)
// ---------------------------------------------------------------------------
import jaCommon from './locales/ja/common.json';
import jaConsent from './locales/ja/consent.json';
import jaBaa from './locales/ja/baa.json';
import jaSummary from './locales/ja/summary.json';
import jaErrors from './locales/ja/errors.json';

// ---------------------------------------------------------------------------
// KO bundles — bản dịch thật (thị trường Hàn Quốc)
// ---------------------------------------------------------------------------
import koCommon from './locales/ko/common.json';
import koConsent from './locales/ko/consent.json';
import koBaa from './locales/ko/baa.json';
import koSummary from './locales/ko/summary.json';
import koErrors from './locales/ko/errors.json';

// ---------------------------------------------------------------------------
// Supported locales — 4 thị trường: Global / Việt Nam / Nhật Bản / Hàn Quốc
// ---------------------------------------------------------------------------
export const SUPPORTED_LANGUAGES = ['vi', 'en', 'ja', 'ko'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
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
      ja: {
        common: jaCommon,
        consent: jaConsent,
        baa: jaBaa,
        summary: jaSummary,
        errors: jaErrors,
      },
      ko: {
        common: koCommon,
        consent: koConsent,
        baa: koBaa,
        summary: koSummary,
        errors: koErrors,
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
