/**
 * Export wizard state machine — manages multi-step export flow.
 * States: idle → configuring → exporting → complete → error
 */

import { useState, useCallback } from 'react';
import { exportApi } from '../api/export-api';
import i18n from '../i18n';
import type { ExportJob, StartExportRequest } from '../api/export-api';

export type ExportStep = 1 | 2 | 3 | 4 | 5 | 6;

export type ExportFlowState =
  | { phase: 'idle' }
  | { phase: 'configuring'; step: ExportStep }
  | { phase: 'exporting'; jobId: string }
  | { phase: 'complete'; job: ExportJob }
  | { phase: 'error'; message: string };

export interface ExportWizardConfig {
  connectorType: 'fhir' | 'file';
  fhirUrl?: string;
  clientId?: string;
  clientSecret?: string;
  patientId?: string;
  fileUploadId?: string;
  columnMapping?: Record<string, string>;
  format: 'json' | 'ndjson';
  includeSummary: boolean;
  summaryProvider?: string;
  summaryLanguage?: string;
}

const DEFAULT_CONFIG: ExportWizardConfig = {
  connectorType: 'fhir',
  format: 'json',
  includeSummary: false,
};

export interface UseExportReturn {
  flowState: ExportFlowState;
  config: ExportWizardConfig;
  updateConfig: (partial: Partial<ExportWizardConfig>) => void;
  goToStep: (step: ExportStep) => void;
  startExport: () => Promise<void>;
  reset: () => void;
}

export function useExport(): UseExportReturn {
  const [flowState, setFlowState] = useState<ExportFlowState>({ phase: 'idle' });
  const [config, setConfig] = useState<ExportWizardConfig>(DEFAULT_CONFIG);

  const updateConfig = useCallback((partial: Partial<ExportWizardConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  const goToStep = useCallback((step: ExportStep) => {
    setFlowState({ phase: 'configuring', step });
  }, []);

  const startExport = useCallback(async () => {
    const req: StartExportRequest = {
      connectorType: config.connectorType,
      connectorConfig:
        config.connectorType === 'fhir'
          ? { url: config.fhirUrl, clientId: config.clientId, clientSecret: config.clientSecret }
          : undefined,
      patientId: config.patientId,
      fileUploadId: config.fileUploadId,
      format: config.format,
      includeSummary: config.includeSummary,
      summaryProvider: config.summaryProvider,
      summaryLanguage: config.summaryLanguage,
    };

    try {
      const job = await exportApi.startExport(req);
      setFlowState({ phase: 'exporting', jobId: job.id });
    } catch (err) {
      setFlowState({
        phase: 'error',
        message: err instanceof Error ? err.message : i18n.t('export_failed', { ns: 'errors' }),
      });
    }
  }, [config]);

  const reset = useCallback(() => {
    setFlowState({ phase: 'idle' });
    setConfig(DEFAULT_CONFIG);
  }, []);

  return { flowState, config, updateConfig, goToStep, startExport, reset };
}
