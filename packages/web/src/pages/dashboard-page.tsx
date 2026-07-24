/**
 * DashboardPage — recent exports table, quick action cards, health indicator.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpFromLine, ArrowDownToLine, RefreshCw, Activity } from 'lucide-react';
import { PageContainer } from '../components/layout/page-container';
import { StatusBadge } from '../components/shared/status-badge';
import { LoadingSpinner } from '../components/shared/loading-spinner';
import { exportApi, type ExportJob } from '../api/export-api';
import { healthApi, type HealthStatus } from '../api/health-api';
import { maskPatientId, formatDate, formatCount } from '../lib/format-utils';
import { ROUTES } from '../lib/constants';

export function DashboardPage() {
  const navigate = useNavigate();
  const [exports, setExports] = useState<ExportJob[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [jobs, h] = await Promise.allSettled([
        exportApi.listExports(),
        healthApi.checkHealth(),
      ]);
      if (jobs.status === 'fulfilled') setExports(jobs.value);
      if (h.status === 'fulfilled') setHealth(h.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PageContainer
      title="Dashboard"
      description="Recent activity and quick actions"
      actions={
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh"
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-400"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Refresh
        </button>
      }
    >
      {/* Health strip */}
      {health && (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-gray-50 px-4 py-2 text-sm dark:bg-gray-800">
          <Activity className="h-4 w-4 text-gray-400" aria-hidden />
          <span className="text-gray-600 dark:text-gray-300">
            API status:{' '}
            <span
              className={
                health.status === 'ok' ? 'text-green-700 font-medium' : 'text-red-600 font-medium'
              }
            >
              {health.status}
            </span>
          </span>
        </div>
      )}

      {/* Quick actions */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => navigate(ROUTES.EXPORT)}
          className="flex items-center gap-3 rounded-lg border border-primary-200 bg-primary-50 p-4 text-left hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-900/20 dark:hover:bg-primary-900/30"
        >
          <ArrowUpFromLine className="h-6 w-6 text-primary-600" aria-hidden />
          <div>
            <p className="font-medium text-primary-800 dark:text-primary-200">New Export</p>
            <p className="text-xs text-primary-600 dark:text-primary-400">
              Export patient FHIR bundle
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => navigate(ROUTES.IMPORT)}
          className="flex items-center gap-3 rounded-lg border border-teal-200 bg-teal-50 p-4 text-left hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-900/20 dark:hover:bg-teal-900/30"
        >
          <ArrowDownToLine className="h-6 w-6 text-teal-600" aria-hidden />
          <div>
            <p className="font-medium text-teal-800 dark:text-teal-200">Import File</p>
            <p className="text-xs text-teal-700 dark:text-teal-400">
              Upload CSV / Excel / FHIR JSON
            </p>
          </div>
        </button>
      </div>

      {/* Recent exports */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Recent Exports</h2>
        </div>

        {loading ? (
          <div className="py-8">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <p className="px-4 py-6 text-center text-sm text-red-500">{error}</p>
        ) : exports.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-500">
            No exports yet. Start with "New Export".
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Date
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Patient ID
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Resources
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {exports.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(job.createdAt ?? '')}
                    </td>
                    <td className="px-4 py-2 font-mono text-gray-700 dark:text-gray-300">
                      {maskPatientId(job.patientId ?? '')}
                    </td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">
                      {formatCount(job.resourceCount, 'resource')}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={job.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
