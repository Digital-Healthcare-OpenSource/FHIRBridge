/**
 * Synthesis engine — combines section summaries into a coherent patient narrative.
 * This is the final AI call in the two-step summary pipeline.
 * Operates only on de-identified section summaries.
 */

import type { SectionSummary, SummaryConfig } from '@fhirbridge/types';
import type { AiProvider } from './ai-provider-interface.js';
import type { TokenTracker } from './token-tracker.js';
import { getSynthesisPrompt } from './prompt-templates.js';

/** Synthesis section label in token tracker */
const SYNTHESIS_SECTION = 'synthesis';

/**
 * Options controlling synthesis.
 */
export interface SynthesizeOptions {
  /** True khi dates trong output vẫn bị shift (multi-patient) — prompt nêu rõ. */
  datesShifted?: boolean;
}

/**
 * Dosage-like tokens: a number followed by a clinical unit (mg, mcg, g, ml,
 * units, IU, %). Deterministic — no model involved. Used to detect dosage
 * values the synthesis invents that are absent from its source section text.
 */
const DOSAGE_TOKEN_RE = /\b\d+(?:\.\d+)?\s?(?:mg|mcg|µg|g|ml|l|units?|iu|%)\b/gi;

/** Normalize a dosage token for whitespace/case-insensitive comparison. */
function normalizeDosage(token: string): string {
  return token.toLowerCase().replace(/\s+/g, '');
}

/**
 * Deterministic hallucination guard for the synthesis step.
 * The synthesis narrative must not introduce dosage values that do not appear
 * in its source section summaries. Returns the distinct unverified tokens.
 */
function findUnverifiedDosages(output: string, sourceText: string): string[] {
  const sourceNormalized = new Set((sourceText.match(DOSAGE_TOKEN_RE) ?? []).map(normalizeDosage));
  const unverified = new Set<string>();
  for (const token of output.match(DOSAGE_TOKEN_RE) ?? []) {
    if (!sourceNormalized.has(normalizeDosage(token))) {
      unverified.add(token.trim());
    }
  }
  return [...unverified];
}

/**
 * Combine section summaries into a unified patient narrative.
 * Filters out empty sections before synthesis.
 *
 * @param sections - De-identified section summaries from section-summarizer
 * @param provider - AI provider to use for synthesis
 * @param config - Summary configuration
 * @param tracker - Token tracker for billing
 * @returns Synthesized narrative string
 */
export async function synthesize(
  sections: SectionSummary[],
  provider: AiProvider,
  config: SummaryConfig,
  tracker: TokenTracker,
  options: SynthesizeOptions = {},
): Promise<string> {
  // Only include sections that actually summarized resources. Filtering on the
  // exact resourceCount (not a substring of the content) keeps a real section
  // whose narrative legitimately mentions the phrase "No data available".
  const meaningfulSections = sections.filter(
    (s) => s.resourceCount > 0 && s.content.trim().length > 0,
  );

  if (meaningfulSections.length === 0) {
    return 'Insufficient data available to generate a patient summary.';
  }

  const { systemPrompt, userPrompt } = getSynthesisPrompt(
    meaningfulSections.map((s) => ({ section: s.section, content: s.content })),
    {
      language: config.language,
      detailLevel: config.detailLevel,
      datesShifted: options.datesShifted ?? false,
    },
  );

  const response = await provider.generate(userPrompt, {
    maxTokens: config.providerConfig.maxTokens,
    temperature: config.providerConfig.temperature,
    systemPrompt,
    timeoutMs: config.providerConfig.timeoutMs,
  });

  tracker.track(
    config.providerConfig.provider,
    provider.model,
    SYNTHESIS_SECTION,
    response.tokenUsage.inputTokens,
    response.tokenUsage.outputTokens,
  );

  // Hallucination post-check: flag dosage values the synthesis introduced that
  // are absent from the source section summaries. Do not silently pass them.
  const sourceText = meaningfulSections.map((s) => s.content).join('\n');
  const unverified = findUnverifiedDosages(response.content, sourceText);
  if (unverified.length > 0) {
    return `${response.content}\n\n⚠️ UNVERIFIED: the following dosage values could not be matched to the source section data and may be inaccurate — verify against source records: ${unverified.join(', ')}.`;
  }

  return response.content;
}
