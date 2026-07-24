/**
 * AppHeader — top bar with breadcrumb and settings link.
 */

import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Settings } from 'lucide-react';
import { ROUTES } from '../../lib/constants';

const BREADCRUMB_MAP: Record<string, string> = {
  [ROUTES.DASHBOARD]: 'Dashboard',
  [ROUTES.EXPORT]: 'Export',
  [ROUTES.IMPORT]: 'Import',
  [ROUTES.SETTINGS]: 'Settings',
};

function useBreadcrumb(): Array<{ label: string; href: string }> {
  const { pathname } = useLocation();
  const label = BREADCRUMB_MAP[pathname] ?? pathname.split('/').filter(Boolean).pop() ?? 'Page';
  if (pathname === ROUTES.DASHBOARD) return [{ label: 'Dashboard', href: ROUTES.DASHBOARD }];
  return [
    { label: 'Dashboard', href: ROUTES.DASHBOARD },
    { label, href: pathname },
  ];
}

export function AppHeader() {
  const crumbs = useBreadcrumb();

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3 dark:border-gray-700 dark:bg-gray-900">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-1 text-sm">
          {crumbs.map((crumb, idx) => (
            <li key={crumb.href} className="flex items-center gap-1">
              {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-400" aria-hidden />}
              {idx === crumbs.length - 1 ? (
                <span className="font-medium text-gray-800 dark:text-gray-200">{crumb.label}</span>
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

      {/* Settings shortcut */}
      <Link
        to={ROUTES.SETTINGS}
        aria-label="Settings"
        className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
      >
        <Settings className="h-4 w-4" aria-hidden />
      </Link>
    </header>
  );
}
