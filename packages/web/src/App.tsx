/**
 * App — router setup with code-split lazy pages.
 * '/'       → public LandingPage (no sidebar)
 * '/app/*'  → authenticated app shell with sidebar + header
 *
 * Each non-trivial page is React.lazy'd so the initial JS bundle stays small.
 * The landing page is also lazy because most direct visitors stay on '/' and
 * the app shell never loads for them.
 */

import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppSidebar } from './components/layout/app-sidebar';
import { AppHeader } from './components/layout/app-header';
import { ErrorBoundary } from './components/shared/error-boundary';
import { healthApi } from './api/health-api';
import { ROUTES } from './lib/constants';

const LandingPage = lazy(() =>
  import('./pages/landing-page').then((m) => ({ default: m.LandingPage })),
);
const DashboardPage = lazy(() =>
  import('./pages/dashboard-page').then((m) => ({ default: m.DashboardPage })),
);
const ExportWizardPage = lazy(() =>
  import('./pages/export-wizard-page').then((m) => ({ default: m.ExportWizardPage })),
);
const ImportPage = lazy(() =>
  import('./pages/import-page').then((m) => ({ default: m.ImportPage })),
);
const SummaryViewerPage = lazy(() =>
  import('./pages/summary-viewer-page').then((m) => ({ default: m.SummaryViewerPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/settings-page').then((m) => ({ default: m.SettingsPage })),
);

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function useHealthCheck() {
  const [healthOk, setHealthOk] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const h = await healthApi.checkHealth();
        if (!cancelled) setHealthOk(h.status === 'ok');
      } catch {
        if (!cancelled) setHealthOk(false);
      }
    };
    void check();
    const interval = setInterval(() => void check(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return healthOk;
}

function AppShell() {
  const healthOk = useHealthCheck();

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Skip link — focusable đầu tiên, nhảy thẳng vào main content (WCAG 2.4.1) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary-600 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>
      <AppSidebar healthOk={healthOk} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppHeader />
        <main className="flex-1 overflow-y-auto" id="main-content" tabIndex={-1}>
          <ErrorBoundary>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="export" element={<ExportWizardPage />} />
                <Route path="import" element={<ImportPage />} />
                <Route path="summary/:id" element={<SummaryViewerPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to={ROUTES.DASHBOARD} replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path={ROUTES.LANDING} element={<LandingPage />} />
        <Route path="/app/*" element={<AppShell />} />
        <Route path="*" element={<Navigate to={ROUTES.LANDING} replace />} />
      </Routes>
    </Suspense>
  );
}
