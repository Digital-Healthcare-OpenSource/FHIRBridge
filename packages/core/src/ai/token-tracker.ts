/**
 * Token usage tracker for billing integration.
 * Accumulates token counts across all AI calls in a summary session.
 * Logs counts only — never prompt content or PHI.
 */

import type { AiProviderName, TokenUsage } from '@fhirbridge/types';

/** Cost per 1K tokens by provider and direction (USD) */
const TOKEN_COSTS_PER_1K: Record<AiProviderName, { input: number; output: number }> = {
  claude: { input: 0.005, output: 0.025 }, // claude-opus-5 list price ($5 / $25 per 1M)
  openai: { input: 0.005, output: 0.015 }, // gpt-4o pricing estimate
};

/** Per-request token record */
export interface TokenRecord {
  provider: AiProviderName;
  model: string;
  section: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

/** Aggregated token usage across all requests */
export interface AggregatedTokenUsage extends TokenUsage {
  estimatedCostUsd: number;
  records: TokenRecord[];
}

/**
 * Tracks token usage and estimated costs across a summary generation session.
 * Thread-safe for sequential calls (no concurrent modification expected).
 */
export class TokenTracker {
  private readonly records: TokenRecord[] = [];
  private budgetWarningThreshold: number | undefined;

  constructor(budgetWarningTokens?: number) {
    this.budgetWarningThreshold = budgetWarningTokens;
  }

  /**
   * Record token usage for a single AI call.
   * @param provider - Provider name for cost calculation
   * @param model - Model identifier
   * @param section - Section or step name (for audit trail)
   * @param inputTokens - Tokens in the prompt
   * @param outputTokens - Tokens in the response
   */
  track(
    provider: AiProviderName,
    model: string,
    section: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    const costs = TOKEN_COSTS_PER_1K[provider] ?? { input: 0, output: 0 };
    const estimatedCostUsd =
      (inputTokens / 1000) * costs.input + (outputTokens / 1000) * costs.output;

    this.records.push({
      provider,
      model,
      section,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
    });

    // Warn when approaching budget
    if (this.budgetWarningThreshold !== undefined) {
      const total = this.getTotalTokens();
      if (total > this.budgetWarningThreshold * 0.9) {
        // Emit to stderr only — never log prompts or PHI
        process.stderr.write(
          `[TokenTracker] WARNING: ${total} tokens used, approaching budget of ${this.budgetWarningThreshold}\n`,
        );
      }
    }
  }

  /**
   * Get aggregated usage across all tracked calls.
   */
  getUsage(): AggregatedTokenUsage {
    const inputTokens = this.records.reduce((sum, r) => sum + r.inputTokens, 0);
    const outputTokens = this.records.reduce((sum, r) => sum + r.outputTokens, 0);
    const estimatedCostUsd = this.records.reduce((sum, r) => sum + r.estimatedCostUsd, 0);

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd,
      records: [...this.records],
    };
  }

  /**
   * Get total tokens consumed so far.
   */
  getTotalTokens(): number {
    return this.records.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);
  }

  /**
   * Check whether the given token budget would be exceeded.
   */
  wouldExceedBudget(additionalTokens: number, budget: number): boolean {
    return this.getTotalTokens() + additionalTokens > budget;
  }

  /**
   * Reset all tracked records (for reuse across sessions).
   */
  reset(): void {
    this.records.length = 0;
  }
}
