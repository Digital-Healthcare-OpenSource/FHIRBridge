/**
 * StatusBadge — coloured pill for export/summary status values.
 * Enum trạng thái → nhãn đã dịch (common:job_status.*); giá trị lạ hiển thị nguyên văn.
 */

import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n/use-translation';

const KNOWN_STATUSES = [
  'pending',
  'processing',
  'running',
  'generating',
  'complete',
  'error',
] as const;
type KnownStatus = (typeof KNOWN_STATUSES)[number];

const statusStyles: Record<KnownStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  generating: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  complete: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

function isKnownStatus(status: string): status is KnownStatus {
  return (KNOWN_STATUSES as readonly string[]).includes(status);
}

interface Props {
  /** Trạng thái export/summary; giá trị ngoài KNOWN_STATUSES hiển thị nguyên văn */
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: Props) {
  const { t } = useTranslation('common');
  const known = isKnownStatus(status);
  const style = known ? statusStyles[status] : 'bg-gray-100 text-gray-700';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        style,
        className,
      )}
    >
      {known ? t(`job_status.${status}`) : status}
    </span>
  );
}
