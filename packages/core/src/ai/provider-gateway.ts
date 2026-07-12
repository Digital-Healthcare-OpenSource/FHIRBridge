/**
 * Provider gateway — orchestrates full summary generation pipeline.
 * Handles provider selection, fallback on failure, and event emission.
 * Flow: deidentify → section summaries → synthesis → (re-identify dates) → PatientSummary
 */

import { EventEmitter } from 'node:events';
import type {
  Bundle,
  SummaryConfig,
  PatientSummary,
  SectionSummary,
  AiProviderName,
  DateShiftMap,
  DeidentifiedBundle,
} from '@fhirbridge/types';
import type { AiProvider } from './ai-provider-interface.js';
import { ClaudeProvider } from './claude-provider.js';
import { OpenAiProvider } from './openai-provider.js';
import { deidentify, reidentifyDates } from './deidentifier.js';
import { summarizeSections } from './section-summarizer.js';
import { synthesize } from './synthesis-engine.js';
import { buildDisclaimer } from './summary-formatter.js';
import { TokenTracker } from './token-tracker.js';

/** Events emitted by ProviderGateway */
export interface GatewayEvents {
  'provider-switch': [from: string, to: string, reason: string];
  'rate-limited': [provider: string, retryAfterMs: number];
  'generation-complete': [summary: PatientSummary];
}

/**
 * Orchestrates the full AI summary pipeline with provider fallback.
 * Emits events for monitoring and observability.
 */
export class ProviderGateway extends EventEmitter {
  private readonly primaryProvider: AiProvider;
  private readonly fallbackProvider: AiProvider | undefined;

  constructor(config: SummaryConfig) {
    super();
    this.primaryProvider = this.createProvider(config.providerConfig);

    if (config.fallbackProviderConfig) {
      this.fallbackProvider = this.createProvider(config.fallbackProviderConfig);
    }
  }

  /**
   * Run the full summary pipeline on a FHIR Bundle.
   * De-identifies the bundle first, then generates section summaries,
   * then synthesizes into a coherent patient narrative.
   *
   * Dates: for a single-patient bundle the shifted dates are re-identified back
   * to real dates in the output so clinicians see accurate timelines. For a
   * multi-patient bundle re-identification is unsafe (dates would be corrupted),
   * so dates stay shifted and every prompt + the disclaimer say so explicitly.
   */
  async summarize(bundle: Bundle, config: SummaryConfig): Promise<PatientSummary> {
    const tracker = new TokenTracker();

    // Step 1: De-identify — MUST happen before any AI call. Keep the shiftMap.
    const { bundle: deidentifiedBundle, shiftMap } = deidentify(bundle, config.hmacSecret);
    const singlePatient = ProviderGateway.isSinglePatient(bundle);

    // Step 2: Try primary provider, fall back if needed
    try {
      const summary = await this.runPipeline(
        this.primaryProvider,
        config.providerConfig.provider,
        deidentifiedBundle,
        shiftMap,
        singlePatient,
        config,
        tracker,
      );
      this.emit('generation-complete', summary);
      return summary;
    } catch (primaryErr) {
      if (!this.fallbackProvider) {
        throw primaryErr;
      }

      const reason = primaryErr instanceof Error ? primaryErr.message : 'unknown error';
      this.emit('provider-switch', this.primaryProvider.name, this.fallbackProvider.name, reason);

      const fallbackConfig = config.fallbackProviderConfig!;
      const summary = await this.runPipeline(
        this.fallbackProvider,
        fallbackConfig.provider,
        deidentifiedBundle,
        shiftMap,
        singlePatient,
        config,
        tracker,
      );
      this.emit('generation-complete', summary);
      return summary;
    }
  }

  /**
   * Generate sections + synthesis with one provider and assemble the summary.
   * Applies date re-identification (single-patient) or the shifted-date
   * disclaimer (multi-patient).
   */
  private async runPipeline(
    provider: AiProvider,
    providerName: AiProviderName,
    deidentifiedBundle: DeidentifiedBundle,
    shiftMap: DateShiftMap,
    singlePatient: boolean,
    config: SummaryConfig,
    tracker: TokenTracker,
  ): Promise<PatientSummary> {
    const datesShifted = !singlePatient;

    const sections = await summarizeSections(deidentifiedBundle, provider, config, tracker, {
      datesShifted,
    });
    const synthesis = await synthesize(sections, provider, config, tracker, { datesShifted });

    let finalSections: SectionSummary[] = sections;
    let finalSynthesis = synthesis;
    let disclaimer: string;

    if (singlePatient) {
      // Restore real dates for clinicians (spread preserves truncated / excluded flags).
      finalSections = sections.map((s) => ({
        ...s,
        content: reidentifyDates(s.content, shiftMap),
      }));
      finalSynthesis = reidentifyDates(synthesis, shiftMap);
      disclaimer = buildDisclaimer(config.language);
    } else {
      const shiftDays = Math.abs(Object.values(shiftMap)[0] ?? 0);
      const note = `All dates have been shifted ±${shiftDays} days for privacy and are not real calendar dates.`;
      disclaimer = buildDisclaimer(config.language, note);
    }

    const usage = tracker.getUsage();
    return {
      sections: finalSections,
      synthesis: finalSynthesis,
      metadata: {
        generatedAt: new Date().toISOString(),
        provider: providerName,
        model: provider.model,
        totalTokens: usage.totalTokens,
        language: config.language,
        deidentified: true,
        disclaimer,
      },
    };
  }

  /** True when the bundle contains at most one Patient resource. */
  private static isSinglePatient(bundle: Bundle): boolean {
    const patientCount = (bundle.entry ?? []).filter(
      (e) => e.resource?.resourceType === 'Patient',
    ).length;
    return patientCount <= 1;
  }

  private createProvider(config: SummaryConfig['providerConfig']): AiProvider {
    if (config.provider === 'claude') {
      return new ClaudeProvider(config);
    }
    if (config.provider === 'openai') {
      return new OpenAiProvider(config);
    }
    throw new Error(`ProviderGateway: unknown provider "${config.provider}"`);
  }
}
