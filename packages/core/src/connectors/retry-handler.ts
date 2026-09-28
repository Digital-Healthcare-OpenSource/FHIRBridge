/**
 * Exponential backoff retry handler.
 * Retries transient errors (network, 429, 5xx) with configurable delays.
 * Never retries 4xx client errors (except 429 Too Many Requests).
 */

import { ConnectorError } from './his-connector-interface.js';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds — doubles each attempt (default: 100) */
  baseDelay?: number;
  /** Maximum delay cap in milliseconds (default: 5000) */
  maxDelay?: number;
}

/** HTTP status codes that should NOT be retried */
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 405, 409, 410, 422]);

/**
 * Determine whether an error is retryable based on HTTP status or error type.
 * 4xx errors (except 429) are not retried.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ConnectorError) {
    return error.retryable;
  }

  // Check for HTTP status in error message pattern "HTTP 4xx"
  if (error instanceof Error) {
    const statusMatch = error.message.match(/\bHTTP (\d{3})\b/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1]!, 10);
      if (NON_RETRYABLE_STATUS.has(status)) return false;
      // 429 Too Many Requests and 5xx are retryable
      if (status === 429 || status >= 500) return true;
    }
    // Network errors (no status) are retryable
    return true;
  }

  return true;
}

/**
 * Execute fn with exponential backoff retries.
 * Delays: baseDelay * 2^attempt (100ms, 200ms, 400ms for defaults)
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns Result of fn on success
 * @throws Last error after all retries exhausted
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries = 3, baseDelay = 100, maxDelay = 5000 } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry non-retryable errors
      if (!isRetryable(err)) {
        throw err;
      }

      // Don't delay after the last attempt
      if (attempt === maxRetries) break;

      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      await sleep(delay);
    }
  }

  throw lastError;
}

/** Promise-based sleep utility */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
