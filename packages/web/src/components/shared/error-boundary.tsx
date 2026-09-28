/**
 * ErrorBoundary — catches render errors and shows a fallback UI.
 * Class component không dùng hook được → fallback tách thành function component để dịch.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { useTranslation } from '../../i18n/use-translation';

/** Giới hạn độ dài message để tránh log rò rỉ nội dung dài (có thể chứa PHI). */
const MAX_LOGGED_MESSAGE_LENGTH = 200;

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      // Rỗng → fallback hiển thị errors:unexpected theo ngôn ngữ hiện tại
      message: error instanceof Error ? error.message : '',
    };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    // PHI-safety: chỉ log name + message đã cắt ngắn. KHÔNG log raw error object
    // hoặc componentStack (info) — props/state render có thể chứa dữ liệu bệnh nhân.
    const message = error.message.slice(0, MAX_LOGGED_MESSAGE_LENGTH);
    console.error(`[ErrorBoundary] ${error.name}: ${message}`);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <ErrorFallback
          message={this.state.message}
          onReset={() => this.setState({ hasError: false, message: '' })}
        />
      );
    }
    return this.props.children;
  }
}

function ErrorFallback({ message, onReset }: { message: string; onReset: () => void }) {
  const { t } = useTranslation('errors');
  const { t: tCommon } = useTranslation('common');
  return (
    <div
      role="alert"
      className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20"
    >
      <p className="text-sm font-medium text-red-700 dark:text-red-300">{t('boundary_title')}</p>
      <p className="mt-1 text-xs text-red-500 dark:text-red-400">{message || t('unexpected')}</p>
      <button
        type="button"
        className="mt-4 rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700"
        onClick={onReset}
      >
        {tCommon('action.try_again')}
      </button>
    </div>
  );
}
