/**
 * LoadingSpinner — accessible activity indicator.
 */

import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n/use-translation';

interface Props {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-2',
  lg: 'h-12 w-12 border-4',
};

export function LoadingSpinner({ size = 'md', className, label }: Props) {
  const { t } = useTranslation('common');
  const text = label ?? t('app.loading');
  return (
    <div
      className={cn('flex items-center justify-center', className)}
      role="status"
      aria-label={text}
    >
      <div
        className={cn(
          'animate-spin rounded-full border-primary-200 border-t-primary-600',
          sizeClasses[size],
        )}
      />
      <span className="sr-only">{text}</span>
    </div>
  );
}
