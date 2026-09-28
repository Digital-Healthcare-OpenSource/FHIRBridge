/**
 * @fhirbridge/core/ai
 * AI Summary Engine — provider-agnostic two-step FHIR summary generation.
 *
 * Flow: FHIR Bundle → deidentify → section summaries → synthesis → formatted output
 */

// Provider interface and adapters
export type { AiProvider } from './ai-provider-interface.js';
export { ClaudeProvider, CLAUDE_DEFAULT_MODEL } from './claude-provider.js';
export { OpenAiProvider, OPENAI_DEFAULT_MODEL } from './openai-provider.js';
export { ProviderGateway } from './provider-gateway.js';

// De-identification (PRIVACY CRITICAL)
export { deidentify, reidentifyDates, hashIdentifier, shiftDate } from './deidentifier.js';
export type { DeidentifyResult } from './deidentifier.js';

// Summary pipeline
export { summarizeSections } from './section-summarizer.js';
export { synthesize } from './synthesis-engine.js';

// Prompt templates
export { getSectionPrompt, getSynthesisPrompt, isSupportedSection } from './prompt-templates.js';
export type { PromptVariables, PromptPair, SectionName } from './prompt-templates.js';

// Output formatters
export {
  formatMarkdown,
  formatComposition,
  formatPdf,
  fitsBuiltInPdfFont,
  PdfFontRequiredError,
} from './summary-formatter.js';
export type { PdfFormatOptions } from './summary-formatter.js';
export type { FhirComposition } from './summary-formatter.js';

// Token tracking
export { TokenTracker } from './token-tracker.js';
export type { TokenRecord, AggregatedTokenUsage } from './token-tracker.js';
