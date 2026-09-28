/**
 * SettingsPage — FHIRBridge API credential, interface language, and theme toggle.
 *
 * Credential = API key trong API_KEYS (.env của server, tạo bởi `pnpm run setup`)
 * hoặc JWT — KHÔNG phải key của nhà cung cấp AI. Chỉ giữ trong memory, không
 * bao giờ ghi vào browser storage.
 */

import { useState } from 'react';
import { Trans } from 'react-i18next';
import { Eye, EyeOff, Moon, Sun } from 'lucide-react';
import { PageContainer } from '../components/layout/page-container';
import { LanguageSwitcher } from '../components/shared/language-switcher';
import { setAuthToken } from '../api/api-client';
import { useTranslation } from '../i18n/use-translation';

const SECTION_CLASS = 'rounded-lg border border-gray-200 p-5 dark:border-gray-700';
const HEADING_CLASS = 'mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300';
const HELP_CLASS = 'mb-3 text-xs text-gray-500 dark:text-gray-400';

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    setDark(next);
  };
  return { dark, toggle };
}

export function SettingsPage() {
  const { t } = useTranslation('common');
  const { dark, toggle } = useTheme();
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setAuthToken(apiKey || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <PageContainer title={t('nav.settings')} description={t('settings.description')}>
      <div className="mx-auto max-w-xl space-y-6">
        {/* FHIRBridge credential — ô password ĐẦU TIÊN trên trang (e2e auth helper dựa vào) */}
        <section className={SECTION_CLASS} aria-labelledby="credential-heading">
          <h2 id="credential-heading" className={HEADING_CLASS}>
            {t('settings.credential_heading')}
          </h2>
          <p id="credential-help" className={HELP_CLASS}>
            <Trans
              t={t}
              i18nKey="settings.credential_help"
              components={{ code: <code className="font-mono" /> }}
            />
          </p>
          <label
            htmlFor="api-credential"
            className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
          >
            {t('settings.credential_label')}
          </label>
          <div className="relative">
            <input
              id="api-credential"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('settings.credential_placeholder')}
              aria-describedby="credential-help credential-memory"
              className="w-full rounded-md border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-primary-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label={showKey ? t('settings.hide_key') : t('settings.show_key')}
            >
              {showKey ? (
                <EyeOff className="h-4 w-4" aria-hidden />
              ) : (
                <Eye className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>
          <p id="credential-memory" className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t('settings.credential_memory')}
          </p>
        </section>

        {/* Interface language — cũng là ngôn ngữ tóm tắt AI mặc định */}
        <section className={SECTION_CLASS} aria-labelledby="language-heading">
          <h2 id="language-heading" className={HEADING_CLASS}>
            {t('settings.language_heading')}
          </h2>
          <p className={HELP_CLASS}>{t('settings.language_help')}</p>
          {/* id giữ 'default-language' — selector e2e (tests/e2e/web/pages/settings.page.ts) */}
          <LanguageSwitcher id="default-language" selectClassName="w-full px-3 py-2" />
        </section>

        {/* Theme */}
        <section className={SECTION_CLASS} aria-labelledby="appearance-heading">
          <h2 id="appearance-heading" className={HEADING_CLASS}>
            {t('settings.appearance_heading')}
          </h2>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {dark ? t('settings.dark_mode') : t('settings.light_mode')}
            </span>
            <button
              type="button"
              onClick={toggle}
              aria-label={t('settings.toggle_theme')}
              aria-pressed={dark}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {dark ? (
                <Sun className="h-4 w-4" aria-hidden />
              ) : (
                <Moon className="h-4 w-4" aria-hidden />
              )}
              {dark ? t('settings.switch_to_light') : t('settings.switch_to_dark')}
            </button>
          </div>
        </section>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            {t('settings.save')}
          </button>
          {saved && (
            <span role="status" className="text-sm text-green-600">
              {t('settings.saved')}
            </span>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
