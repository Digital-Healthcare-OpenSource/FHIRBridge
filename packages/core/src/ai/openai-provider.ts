/**
 * OpenAI provider adapter.
 * Wraps the openai package and maps to the AiProvider interface.
 * Handles rate limiting with exponential backoff.
 */

import OpenAI from 'openai';
import type { AiProviderConfig, AiResponse, GenerateOptions } from '@fhirbridge/types';
import type { AiProvider } from './ai-provider-interface.js';

/** Default OpenAI model used when no model is specified in config */
export const OPENAI_DEFAULT_MODEL = 'gpt-4o';

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OpenAI adapter implementing AiProvider.
 * API key is sourced from config.apiKey — load from OPENAI_API_KEY env var.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  readonly model: string;

  private readonly client: OpenAI;

  constructor(config: AiProviderConfig) {
    this.model = config.model || OPENAI_DEFAULT_MODEL;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      timeout: config.timeoutMs ?? 60_000,
    });
  }

  /**
   * Generate a completion via chat.completions.create().
   * Retries up to MAX_RETRIES times on 429 rate limit errors.
   */
  async generate(prompt: string, options: GenerateOptions): Promise<AiResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        if (options.systemPrompt) {
          messages.push({ role: 'system', content: options.systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });

        const response = await this.client.chat.completions.create({
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
          messages,
        });

        const choice = response.choices[0];
        const stopReason = choice?.finish_reason;

        // A content-filter stop is a hard failure — do not collapse it into ''.
        if (stopReason === 'content_filter') {
          throw new Error('OpenAiProvider: response blocked by content filter');
        }

        const content = choice?.message?.content ?? '';

        // Empty output is a failure, not a valid summary — surface it so the
        // gateway can fall back instead of emitting a blank section.
        if (content.trim().length === 0) {
          throw new Error('OpenAiProvider: empty response content');
        }

        const finishReason = stopReason === 'length' ? 'max_tokens' : 'stop';

        const usage = response.usage;
        const inputTokens = usage?.prompt_tokens ?? 0;
        const outputTokens = usage?.completion_tokens ?? 0;

        return {
          content,
          tokenUsage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          },
          model: response.model,
          finishReason,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (this.isRateLimitError(err) && attempt < MAX_RETRIES - 1) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError ?? new Error('OpenAiProvider: max retries exceeded');
  }

  /**
   * Check provider availability via a minimal API call.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.client.chat.completions.create({
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
    if (err instanceof OpenAI.RateLimitError) return true;
    if (err instanceof Error && err.message.includes('429')) return true;
    return false;
  }
}
