/**
 * SummaryConfig — selects AI provider, language, and detail level for summary generation.
 *
 * Giá trị option khớp CHÍNH XÁC enum server (packages/api/src/schemas/summary-schemas.ts):
 *   provider ∈ {claude, openai}, language ∈ {en, vi, ja, ko}, detailLevel ∈ {brief, standard, detailed}.
 * Không có ô chọn model — server tự pin model qua ANTHROPIC_MODEL / OPENAI_MODEL.
 */

import { cn } from '../../lib/utils';
import type {
  GenerateSummaryRequest,
  SummaryLanguageCode,
  SummaryProvider,
} from '../../api/summary-api';
import { useTranslation } from '../../i18n/use-translation';
import { LANGUAGE_LABELS, isSupportedLanguage } from '../../i18n/index';

export type SummaryConfigValue = Omit<GenerateSummaryRequest, 'exportId' | 'model'>;

/** Tên thương hiệu — giữ nguyên ở mọi ngôn ngữ. */
export const PROVIDER_LABELS: Record<SummaryProvider, string> = {
  claude: 'Claude (Anthropic)',
  openai: 'GPT (OpenAI)',
};

const PROVIDERS: readonly SummaryProvider[] = ['claude', 'openai'];
const LANGUAGES: readonly SummaryLanguageCode[] = ['en', 'vi', 'ja', 'ko'];
const DETAIL_LEVELS = ['brief', 'standard', 'detailed'] as const;

export const DEFAULT_SUMMARY_PROVIDER: SummaryProvider = 'claude';

/** Ngôn ngữ tóm tắt mặc định = ngôn ngữ UI nếu server hỗ trợ, ngược lại 'en'. */
export function defaultSummaryLanguage(uiLanguage: string | undefined): SummaryLanguageCode {
  return isSupportedLanguage(uiLanguage) ? uiLanguage : 'en';
}

/** Nhãn hiển thị cho provider — giá trị lạ hiển thị nguyên văn. */
export function providerLabel(provider: string): string {
  return provider in PROVIDER_LABELS ? PROVIDER_LABELS[provider as SummaryProvider] : provider;
}

interface Props {
  value: SummaryConfigValue;
  onChange: (cfg: SummaryConfigValue) => void;
  disabled?: boolean;
  className?: string;
}

interface Option {
  value: string;
  label: string;
  lang?: string;
}

function Select({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} lang={opt.lang}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SummaryConfig({ value, onChange, disabled, className }: Props) {
  const { t } = useTranslation('summary');
  const set = (key: keyof SummaryConfigValue) => (v: string) =>
    onChange({ ...value, [key]: v } as SummaryConfigValue);

  const providerOptions = PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABELS[p] }));
  // Nhãn bản ngữ để người đọc nhận ra ngôn ngữ của mình
  const languageOptions = LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABELS[l], lang: l }));
  const detailOptions = DETAIL_LEVELS.map((d) => ({ value: d, label: t(`detail.${d}`) }));

  return (
    <div className={cn('grid gap-4 sm:grid-cols-3', className)}>
      <Select
        id="provider"
        label={t('section.provider_label')}
        value={value.provider}
        options={providerOptions}
        onChange={set('provider')}
        disabled={disabled}
      />
      <Select
        id="language"
        label={t('section.language_label')}
        value={value.language}
        options={languageOptions}
        onChange={set('language')}
        disabled={disabled}
      />
      <Select
        id="detail"
        label={t('section.detail_label')}
        value={value.detailLevel}
        options={detailOptions}
        onChange={set('detailLevel')}
        disabled={disabled}
      />
    </div>
  );
}
