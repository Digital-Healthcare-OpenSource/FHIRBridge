/**
 * AppHeader — top bar with breadcrumb, language switcher and settings link.
 */

import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Settings } from 'lucide-react';
import { ROUTES } from '../../lib/constants';
import { useTranslation } from '../../i18n/use-translation';
import { LanguageSwitcher } from '../shared/language-switcher';

type NavKey = 'nav.dashboard' | 'nav.export' | 'nav.import' | 'nav.settings' | 'nav.summary';

const BREADCRUMB_MAP: Record<string, NavKey> = {
  [ROUTES.DASHBOARD]: 'nav.dashboard',
  [ROUTES.EXPORT]: 'nav.export',
  [ROUTES.IMPORT]: 'nav.import',
  [ROUTES.SETTINGS]: 'nav.settings',
};

/** /app/summary/:id — hiển thị crumb "Tóm tắt AI" thay vì id thô. */
const SUMMARY_PREFIX = '/app/summary/';

function useBreadcrumb(): Array<{ label: string; href: string }> {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();
  const home = { label: t('nav.dashboard'), href: ROUTES.DASHBOARD };
  if (pathname === ROUTES.DASHBOARD) return [home];

  const key: NavKey | undefined =
    BREADCRUMB_MAP[pathname] ?? (pathname.startsWith(SUMMARY_PREFIX) ? 'nav.summary' : undefined);
  const label = key ? t(key) : (pathname.split('/').filter(Boolean).pop() ?? '');
  return [home, { label, href: pathname }];
}

export function AppHeader() {
  const { t } = useTranslation('common');
  const crumbs = useBreadcrumb();

  return (
    <header className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3 dark:border-gray-700 dark:bg-gray-900">
      {/* Breadcrumb */}
      <nav aria-label={t('nav.breadcrumb_aria')}>
        <ol className="flex items-center gap-1 text-sm">
          {crumbs.map((crumb, idx) => (
            <li key={crumb.href} className="flex items-center gap-1">
              {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-400" aria-hidden />}
              {idx === crumbs.length - 1 ? (
                <span className="font-medium text-gray-800 dark:text-gray-200" aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.href}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex items-center gap-2">
        <LanguageSwitcher />
        {/* Settings shortcut */}
        <Link
          to={ROUTES.SETTINGS}
          aria-label={t('nav.settings')}
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <Settings className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </header>
  );
}
