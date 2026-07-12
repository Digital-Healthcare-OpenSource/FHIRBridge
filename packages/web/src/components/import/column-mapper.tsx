/**
 * ColumnMapper — maps source CSV/XLSX columns to FHIR path targets via dropdowns.
 */

import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n/use-translation';

/**
 * Ánh xạ cột → FHIR path. Key là CHỈ SỐ CỘT (dạng chuỗi), KHÔNG phải tên cột —
 * file có 2 header trùng tên vẫn map độc lập được.
 */
export type ColumnMapping = Record<string, string>;

const FHIR_PATHS = [
  '',
  'Patient.id',
  'Patient.name.family',
  'Patient.name.given',
  'Patient.birthDate',
  'Patient.gender',
  'Patient.address.line',
  'Patient.address.city',
  'Patient.address.state',
  'Patient.address.postalCode',
  'Patient.telecom.phone',
  'Patient.telecom.email',
  'Condition.code.text',
  'Observation.code.text',
  'Observation.valueQuantity.value',
  'MedicationRequest.medication.text',
] as const;

/**
 * FHIR path định danh bệnh nhân — cần ít nhất một cái được map thì mới xuất
 * được (nếu không, không có cách nào ghép record về đúng bệnh nhân).
 */
export const IDENTIFYING_FHIR_PATHS: readonly string[] = ['Patient.id'];

/** True khi mapping đã map ít nhất một identifying path. */
export function hasRequiredIdentifiers(mapping: ColumnMapping): boolean {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  return IDENTIFYING_FHIR_PATHS.some((path) => mapped.has(path));
}

/** Các FHIR path bị hai cột trở lên cùng map tới (bỏ qua giá trị rỗng). */
export function findDuplicatePaths(mapping: ColumnMapping): string[] {
  const counts = new Map<string, number>();
  for (const path of Object.values(mapping)) {
    if (!path) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([path]) => path);
}

interface Props {
  sourceColumns: string[];
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
  className?: string;
}

export function ColumnMapper({ sourceColumns, mapping, onChange, className }: Props) {
  const { t } = useTranslation('common');

  const handleChange = (index: number, fhirPath: string) => {
    onChange({ ...mapping, [index]: fhirPath });
  };

  const duplicatePaths = findDuplicatePaths(mapping);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="grid grid-cols-2 gap-x-4 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 px-1">
        <span>{t('mapper.source_column')}</span>
        <span>{t('mapper.fhir_path')}</span>
      </div>
      <div className="space-y-1.5">
        {sourceColumns.map((col, index) => (
          <div key={index} className="grid grid-cols-2 items-center gap-x-4">
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 truncate">
              {col}
            </div>
            <select
              value={mapping[index] ?? ''}
              onChange={(e) => handleChange(index, e.target.value)}
              className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              aria-label={t('mapper.map_aria', { col })}
            >
              <option value="">{t('mapper.skip')}</option>
              {FHIR_PATHS.filter(Boolean).map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {duplicatePaths.length > 0 && (
        <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
          {t('mapper.duplicate_warning', { paths: duplicatePaths.join(', ') })}
        </p>
      )}
    </div>
  );
}
