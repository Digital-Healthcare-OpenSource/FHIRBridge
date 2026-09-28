/**
 * Tests for the exponential backoff retry handler.
 */

import { describe, it, expect, vi } from 'vitest';
import { withRetry, isRetryable } from '../retry-handler.js';
import { ConnectorError } from '../his-connector-interface.js';

describe('isRetryable', () => {
  it('returns true for generic Error (network errors)', () => {
    expect(isRetryable(new Error('ECONNRESET'))).toBe(true);
  });

  it('returns false for HTTP 401 errors', () => {
    expect(isRetryable(new Error('HTTP 401 Unauthorized'))).toBe(false);
  });

  it('returns false for HTTP 403 errors', () => {
    expect(isRetryable(new Error('HTTP 403 Forbidden'))).toBe(false);
  });

  it('returns false for HTTP 404 errors', () => {
    expect(isRetryable(new Error('HTTP 404 Not Found'))).toBe(false);
  });

  it('returns true for HTTP 429 errors', () => {
    expect(isRetryable(new Error('HTTP 429 Too Many Requests'))).toBe(true);
  });

  it('returns true for HTTP 500 errors', () => {
    expect(isRetryable(new Error('HTTP 500 Internal Server Error'))).toBe(true);
  });

  it('returns true for HTTP 503 errors', () => {
    expect(isRetryable(new Error('HTTP 503 Service Unavailable'))).toBe(true);
  });

  it('respects ConnectorError.retryable = false', () => {
    const err = new ConnectorError('Auth failed', 'AUTH_ERROR', false);
    expect(isRetryable(err)).toBe(false);
  });

  it('respects ConnectorError.retryable = true', () => {
    const err = new ConnectorError('Timeout', 'TIMEOUT', true);
    expect(isRetryable(err)).toBe(true);
  });
});

describe('withRetry', () => {
  it('returns result on first successful attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 1 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and succeeds on second attempt', async () => {
    let attempt = 0;
    const fn = vi.fn().mockImplementation(async () => {
      attempt++;
      if (attempt < 2) throw new Error('ECONNRESET');
      return 'success';
    });

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 1 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(withRetry(fn, { maxRetries: 2, baseDelay: 1 })).rejects.toThrow('ECONNRESET');
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('does not retry 401 errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('HTTP 401 Unauthorized'));
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 1 })).rejects.toThrow('HTTP 401');
    expect(fn).toHaveBeenCalledTimes(1); // No retries
  });

  it('does not retry 404 errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('HTTP 404 Not Found'));
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 1 })).rejects.toThrow('HTTP 404');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-retryable ConnectorError', async () => {
    const err = new ConnectorError('Config mismatch', 'CONFIG_MISMATCH', false);
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 1 })).rejects.toThrow('Config mismatch');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses default options (maxRetries=3, baseDelay=100)', async () => {
    // Just verify it resolves with defaults
    const fn = vi.fn().mockResolvedValue(42);
    const result = await withRetry(fn);
    expect(result).toBe(42);
  });
});
