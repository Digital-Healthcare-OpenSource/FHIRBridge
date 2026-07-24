/**
 * AppSidebar — main navigation sidebar with lucide icons.
 */

import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowUpFromLine,
  ArrowDownToLine,
  Settings,
  Activity,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { ROUTES } from '../../lib/constants';

const NAV_ITEMS = [
  { to: ROUTES.DASHBOARD, label: 'Dashboard', Icon: LayoutDashboard },
  { to: ROUTES.EXPORT, label: 'Export', Icon: ArrowUpFromLine },
  { to: ROUTES.IMPORT, label: 'Import', Icon: ArrowDownToLine },
  { to: ROUTES.SETTINGS, label: 'Settings', Icon: Settings },
] as const;

interface Props {
  healthOk?: boolean;
}

export function AppSidebar({ healthOk }: Props) {
  return (
    <aside className="flex h-screen w-56 flex-col border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      {/* Logo */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-4 dark:border-gray-700">
        <Activity className="h-6 w-6 text-primary-600" />
        <span className="text-base font-bold text-gray-900 dark:text-white">FHIRBridge</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main navigation">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ to, label, Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === ROUTES.DASHBOARD}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100',
                  )
                }
              >
                <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Health indicator */}
      <div className="flex items-center gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
        {/* Dot thuần trang trí — text bên cạnh đã mô tả trạng thái (axe: aria-prohibited-attr) */}
        <span
          className={cn(
            'inline-block h-2 w-2 rounded-full',
            healthOk === undefined ? 'bg-gray-400' : healthOk ? 'bg-green-500' : 'bg-red-500',
          )}
          aria-hidden="true"
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {healthOk === undefined ? 'Checking…' : healthOk ? 'API online' : 'API offline'}
        </span>
      </div>
    </aside>
  );
}
