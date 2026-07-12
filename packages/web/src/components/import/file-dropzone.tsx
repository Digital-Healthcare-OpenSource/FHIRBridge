/**
 * FileDropzone — react-dropzone wrapper accepting CSV, XLSX, JSON.
 */

import { useCallback } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { UploadCloud, File as FileIcon, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ACCEPTED_FILE_TYPES, MAX_UPLOAD_SIZE_BYTES } from '../../lib/constants';
import { formatFileSize } from '../../lib/format-utils';
import { useTranslation } from '../../i18n/use-translation';

interface Props {
  onFilesAccepted: (files: File[]) => void;
  onFilesRejected?: (rejections: FileRejection[]) => void;
  selectedFile?: File | null;
  onClearFile?: () => void;
  disabled?: boolean;
  className?: string;
}

export function FileDropzone({
  onFilesAccepted,
  onFilesRejected,
  selectedFile,
  onClearFile,
  disabled,
  className,
}: Props) {
  const { t } = useTranslation('common');
  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      if (accepted.length > 0) onFilesAccepted(accepted);
      if (rejected.length > 0) onFilesRejected?.(rejected);
    },
    [onFilesAccepted, onFilesRejected],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    maxSize: MAX_UPLOAD_SIZE_BYTES,
    maxFiles: 1,
    disabled,
  });

  if (selectedFile) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800',
          className,
        )}
      >
        <FileIcon className="h-5 w-5 flex-shrink-0 text-primary-600" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {selectedFile.name}
          </p>
          <p className="text-xs text-gray-500">{formatFileSize(selectedFile.size)}</p>
        </div>
        {onClearFile && (
          <button
            onClick={onClearFile}
            aria-label={t('dropzone.remove_label')}
            className="rounded p-1 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4 text-gray-400" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
        isDragActive
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
          : 'border-gray-300 hover:border-primary-400 dark:border-gray-600',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input {...getInputProps()} aria-label={t('dropzone.input_label')} />
      <UploadCloud className="mb-3 h-10 w-10 text-gray-400" aria-hidden />
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {isDragActive ? t('dropzone.drop_here') : t('dropzone.instruction')}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        {t('dropzone.hint', { size: formatFileSize(MAX_UPLOAD_SIZE_BYTES) })}
      </p>
    </div>
  );
}
