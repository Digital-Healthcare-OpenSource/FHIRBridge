/**
 * Lightweight Toast notification component.
 * Renders a dismissible banner — replaces native alert() calls in healthcare UI.
 *
 * Usage:
 *   const [toast, setToast] = useState<ToastState | null>(null);
 *   <Toast state={toast} onClose={() => setToast(null)} />
 *   setToast({ message: 'Download failed', variant: 'error' });
 */

import { useEffect } from 'react';
import { X, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n/use-translation';

export type ToastVariant = 'error' | 'success' | 'info';

export interface ToastState {
  message: string;
  variant: ToastVariant;
}

interface Props {
  state: ToastState | null;
  onClose: () => void;
  /** Auto-dismiss after ms. Default 5000. Pass 0 to disable. */
  autoClose?: number;
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  error:
    'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-800 dark:text-red-200',
  success:
    'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/30 dark:border-green-800 dark:text-green-200',
  info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-200',
};

const ICONS: Record<ToastVariant, React.ReactNode> = {
  error: <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden />,
  success: <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden />,
  info: <Info className="h-4 w-4 flex-shrink-0" aria-hidden />,
};

export function Toast({ state, onClose, autoClose = 5000 }: Props) {
  const { t } = useTranslation('common');
  useEffect(() => {
    if (!state || autoClose === 0) return;
    const timer = setTimeout(onClose, autoClose);
    return () => clearTimeout(timer);
  }, [state, autoClose, onClose]);

  if (!state) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-md',
        VARIANT_STYLES[state.variant],
      )}
    >
      {ICONS[state.variant]}
      <p className="flex-1 leading-snug">{state.message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('toast.dismiss')}
        className="ml-1 flex-shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
