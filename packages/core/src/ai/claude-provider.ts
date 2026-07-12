/**
 * Anthropic Claude AI provider adapter.
 * Wraps @anthropic-ai/sdk and maps to the AiProvider interface.
 * Handles rate limiting with exponential backoff.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AiProviderConfig, AiResponse, GenerateOptions } from '@fhirbridge/types';
import type { AiProvider } from './ai-provider-interface.js';

/** Default Claude model used when no model is specified in config */
export const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/** Max retry attempts on rate limit (429) */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff in ms */
const RETRY_BASE_DELAY_MS = 1000;

/** Defensive bounds for generation parameters (API layer sets real defaults). */
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 1;
const MIN_MAX_TOKENS = 1;
const MAX_MAX_TOKENS = 100_000;

/** Clamp a finite number into [lo, hi]; fall back to `fallback` if not finite. */
function clampNumber(value: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Sleeps for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Anthropic Claude adapter implementing AiProvider.
 * API key is sourced from config.apiKey — load from ANTHROPIC_API_KEY env var.
 */
export class ClaudeProvider implements AiProvider {
  readonly name = 'claude';
  readonly model: string;

  private readonly client: Anthropic;

  constructor(config: AiProviderConfig) {
    this.model = config.model || CLAUDE_DEFAULT_MODEL;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      timeout: config.timeoutMs ?? 60_000,
    });
  }

  /**
   * Generate a completion via Anthropic messages.create().
   * Retries up to MAX_RETRIES times on 429 rate limit errors.
   */
  async generate(prompt: string, options: GenerateOptions): Promise<AiResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];

        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: Math.floor(
            clampNumber(options.maxTokens, MIN_MAX_TOKENS, MAX_MAX_TOKENS, MAX_MAX_TOKENS),
          ),
          temperature: clampNumber(
            options.temperature,
            MIN_TEMPERATURE,
            MAX_TEMPERATURE,
            MIN_TEMPERATURE,
          ),
          system: options.systemPrompt,
          messages,
        });

        // A refusal is a hard stop — do not collapse it into empty content.
        if (response.stop_reason === 'refusal') {
          throw new Error('ClaudeProvider: response refused by model safety filter');
        }

        const content = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('');

        // Empty output is a failure, not a valid summary — surface it so the
        // gateway can fall back instead of emitting a blank section.
        if (content.trim().length === 0) {
          throw new Error('ClaudeProvider: empty response content');
        }

        const finishReason = response.stop_reason === 'max_tokens' ? 'max_tokens' : 'stop';

        return {
          content,
          tokenUsage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
          },
          model: response.model,
          finishReason,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Retry on rate limit
        if (this.isRateLimitError(err) && attempt < MAX_RETRIES - 1) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError ?? new Error('ClaudeProvider: max retries exceeded');
  }

  /**
   * Check provider availability via a minimal API call.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  private isRateLimitError(err: unknown): boolean {
    if (err instanceof Anthropic.RateLimitError) return true;
    if (err instanceof Error && err.message.includes('429')) return true;
    return false;
  }
}
