/**
 * LanguageSwitcher — dropdown chọn ngôn ngữ VI / EN / JA / KO.
 *
 * - Hiển thị ngôn ngữ hiện tại được highlight
 * - Persist lựa chọn vào localStorage (key: fhirbridge.lang)
 * - Dùng native <select> để tránh thêm dependency UI
 */

import { useI18n, useTranslation } from '../../i18n/use-translation';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '../../i18n/index';
import type { SupportedLanguage } from '../../i18n/index';

interface LanguageSwitcherProps {
  className?: string;
}

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const { i18n } = useI18n();
  const { t } = useTranslation('common');

  // Lấy ngôn ngữ hiện tại — cắt ngắn nếu có region (vd: vi-VN → vi)
  const currentLang = (i18n.language?.split('-')[0] ?? 'vi') as SupportedLanguage;
  const resolvedLang = SUPPORTED_LANGUAGES.includes(currentLang) ? currentLang : 'vi';

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lang = e.target.value as SupportedLanguage;
    void i18n.changeLanguage(lang);
  };

  return (
    <label className={className}>
      <span className="sr-only">{t('language.label')}</span>
      <select
        value={resolvedLang}
        onChange={handleChange}
        aria-label={t('language.label')}
        className="cursor-pointer rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {LANGUAGE_LABELS[lang]}
          </option>
        ))}
      </select>
    </label>
  );
}
