/**
 * ConnectorForm — FHIR endpoint configuration inputs.
 */

import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n/use-translation';

export interface ConnectorConfig {
  url: string;
  clientId: string;
  clientSecret: string;
}

interface Props {
  value: ConnectorConfig;
  onChange: (cfg: ConnectorConfig) => void;
  onTest?: () => void;
  testResult?: { success: boolean; message: string } | null;
  testing?: boolean;
  className?: string;
}

const INPUT_CLASS =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
const LABEL_CLASS = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

export function ConnectorForm({ value, onChange, onTest, testResult, testing, className }: Props) {
  const { t } = useTranslation('common');
  const set = (key: keyof ConnectorConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: e.target.value });

  return (
    <div className={cn('space-y-4', className)}>
      <div>
        <label htmlFor="fhir-url" className={LABEL_CLASS}>
          {t('connector.fhir_url')}{' '}
          <span className="text-red-500" aria-hidden>
            *
          </span>
        </label>
        <input
          id="fhir-url"
          type="url"
          placeholder="https://fhir.example.com/r4"
          value={value.url}
          onChange={set('url')}
          required
          className={INPUT_CLASS}
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor="client-id" className={LABEL_CLASS}>
          {t('connector.client_id')}
        </label>
        <input
          id="client-id"
          type="text"
          placeholder={t('connector.client_id_placeholder')}
          value={value.clientId}
          onChange={set('clientId')}
          className={INPUT_CLASS}
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor="client-secret" className={LABEL_CLASS}>
          {t('connector.client_secret')}
        </label>
        <input
          id="client-secret"
          type="password"
          placeholder={t('connector.client_secret_placeholder')}
          value={value.clientSecret}
          onChange={set('clientSecret')}
          className={INPUT_CLASS}
          autoComplete="new-password"
        />
      </div>

      {onTest && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onTest}
            disabled={!value.url || testing}
            className="rounded-md bg-white border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            {testing ? t('connector.testing') : t('connector.test')}
          </button>
          {testResult && (
            <span
              role="status"
              className={cn('text-sm', testResult.success ? 'text-green-600' : 'text-red-600')}
            >
              {testResult.message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
