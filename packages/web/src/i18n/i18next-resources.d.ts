/**
 * i18next TypeScript declaration merging.
 * Maps namespace → JSON structure so t() is type-safe.
 * EN là fallback + nguồn chuẩn cho key (kể cả plural _one/_other).
 *
 * Pattern: https://www.i18next.com/overview/typescript
 */

import type enCommon from './locales/en/common.json';
import type enConsent from './locales/en/consent.json';
import type enBaa from './locales/en/baa.json';
import type enSummary from './locales/en/summary.json';
import type enErrors from './locales/en/errors.json';
import type enLanding from './locales/en/landing.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof enCommon;
      consent: typeof enConsent;
      baa: typeof enBaa;
      summary: typeof enSummary;
      errors: typeof enErrors;
      landing: typeof enLanding;
    };
  }
}
