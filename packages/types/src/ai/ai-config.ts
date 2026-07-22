/**
 * AI provider configuration types.
 * Defines provider selection, model configuration, and summary generation options.
 */

/** Supported AI provider identifiers */
export type AiProviderName = 'claude' | 'openai';

/** Output format options for patient summaries */
export type SummaryOutputFormat = 'markdown' | 'pdf' | 'composition';

/** Summary detail level */
export type SummaryDetailLevel = 'brief' | 'standard' | 'detailed';

/** Supported summary languages */
export type SummaryLanguage = 'en' | 'vi' | 'ja' | 'ko';

/**
 * Configuration for an AI provider adapter.
 * apiKey should be sourced from environment variables — never hardcoded.
 */
export interface AiProviderConfig {
  /** Which AI provider to use */
  provider: AiProviderName;
  /** Model identifier (e.g. 'claude-sonnet-4-20250514', 'gpt-4o') */
  model: string;
  /** API key — load from ANTHROPIC_API_KEY or OPENAI_API_KEY env vars */
  apiKey: string;
  /** Max tokens for a single AI response */
  maxTokens: number;
  /** Sampling temperature (0.0–1.0); lower = more deterministic */
  temperature: number;
  /** Request timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
}

/**
 * Full configuration for generating a patient summary.
 */
export interface SummaryConfig {
  /** Target language for the generated summary */
  language: SummaryLanguage;
  /** How detailed the summary should be */
  detailLevel: SummaryDetailLevel;
  /** Which output formats to produce */
  outputFormats: SummaryOutputFormat[];
  /** Primary AI provider config */
  providerConfig: AiProviderConfig;
  /** Optional fallback provider if primary fails */
  fallbackProviderConfig?: AiProviderConfig;
  /** HMAC secret for de-identification (sourced from env) */
  hmacSecret: string;
  /** Max total tokens across all AI calls for one summary */
  totalTokenBudget?: number;
}

/**
 * Options passed to AiProvider.generate() for a single call.
 */
export interface GenerateOptions {
  /** Max tokens in the response */
  maxTokens: number;
  /** Sampling temperature */
  temperature: number;
  /** Optional system prompt to set context/persona */
  systemPrompt?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}
