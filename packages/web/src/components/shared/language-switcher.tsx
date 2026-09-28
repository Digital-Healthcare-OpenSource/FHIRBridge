/**
 * LanguageSwitcher — dropdown chọn ngôn ngữ VI / EN / JA / KO.
 *
 * - Nhãn bản ngữ (Tiếng Việt, English, 日本語, 한국어) — không dịch
 * - Persist lựa chọn vào localStorage (key: fhirbridge.lang) qua i18next detector
 * - Dùng native <select> để tránh thêm dependency UI
 */

import { useI18n, useTranslation } from '../../i18n/use-translation';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, toSupportedLanguage } from '../../i18n/index';
import type { SupportedLanguage } from '../../i18n/index';
import { cn } from '../../lib/utils';

interface LanguageSwitcherProps {
  className?: string;
  /** id cho <select> — dùng khi có <label htmlFor> bên ngoài */
  id?: string;
  selectClassName?: string;
}

export function LanguageSwitcher({ className, id, selectClassName }: LanguageSwitcherProps) {
  const { i18n } = useI18n();
  const { t } = useTranslation('common');

  // vi-VN → vi; locale không hỗ trợ → en
  const currentLang = toSupportedLanguage(i18n.resolvedLanguage ?? i18n.language);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    void i18n.changeLanguage(e.target.value as SupportedLanguage);
  };

  return (
    <label className={className}>
      <span className="sr-only">{t('language.label')}</span>
      <select
        id={id}
        value={currentLang}
        onChange={handleChange}
        aria-label={t('language.label')}
        className={cn(
          'cursor-pointer rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200',
          selectClassName,
        )}
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang} value={lang} lang={lang}>
            {LANGUAGE_LABELS[lang]}
          </option>
        ))}
      </select>
    </label>
  );
}
