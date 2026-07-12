/**
 * OpenAI provider tests.
 * Verifies interface compliance and offline behavior (no real API calls).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAiProvider, OPENAI_DEFAULT_MODEL } from '../openai-provider.js';

// Mock the openai SDK so no real HTTP calls occur
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  const OpenAIMock = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
  OpenAIMock.RateLimitError = class RateLimitError extends Error {
    status = 429;
    constructor() {
      super('Rate limit exceeded');
    }
  };
  (OpenAIMock as unknown as Record<string, unknown>)._mockCreate = mockCreate;
  return { default: OpenAIMock };
});

async function getMockCreate() {
  const mod = await import('openai');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod.default as unknown as Record<string, any>)._mockCreate as ReturnType<typeof vi.fn>;
}

const BASE_CONFIG = {
  provider: 'openai' as const,
  model: 'gpt-test-model',
  apiKey: 'test-api-key',
  maxTokens: 1024,
  temperature: 0.3,
};

const GENERATE_OPTIONS = {
  maxTokens: 1024,
  temperature: 0.3,
  systemPrompt: 'You are a test assistant.',
};

describe('OpenAiProvider', () => {
  describe('interface compliance', () => {
    it('has name === "openai"', () => {
      const provider = new OpenAiProvider(BASE_CONFIG);
      expect(provider.name).toBe('openai');
    });

    it('exposes model from config', () => {
      const provider = new OpenAiProvider(BASE_CONFIG);
      expect(provider.model).toBe('gpt-test-model');
    });

    it('uses OPENAI_DEFAULT_MODEL when no model specified', () => {
      const provider = new OpenAiProvider({ ...BASE_CONFIG, model: '' });
      expect(provider.model).toBe(OPENAI_DEFAULT_MODEL);
    });

    it('has generate() and isAvailable() methods', () => {
      const provider = new OpenAiProvider(BASE_CONFIG);
      expect(typeof provider.generate).toBe('function');
      expect(typeof provider.isAvailable).toBe('function');
    });
  });

  describe('generate()', () => {
    beforeEach(async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockReset();
    });

    it('maps OpenAI response to AiResponse shape', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Summary result' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
        model: 'gpt-test-model',
      });

      const provider = new OpenAiProvider(BASE_CONFIG);
      const result = await provider.generate('Summarize this.', GENERATE_OPTIONS);

      expect(result.content).toBe('Summary result');
      expect(result.tokenUsage.inputTokens).toBe(100);
      expect(result.tokenUsage.outputTokens).toBe(50);
      expect(result.tokenUsage.totalTokens).toBe(150);
      expect(result.finishReason).toBe('stop');
    });

    it('sets finishReason to max_tokens when finish_reason is length', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Truncated' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 200, completion_tokens: 1024 },
        model: 'gpt-test-model',
      });

      const provider = new OpenAiProvider(BASE_CONFIG);
      const result = await provider.generate('Prompt', GENERATE_OPTIONS);
      expect(result.finishReason).toBe('max_tokens');
    });

    it('throws when API call fails', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockRejectedValue(new Error('Auth failure'));

      const provider = new OpenAiProvider(BASE_CONFIG);
      await expect(provider.generate('Prompt', GENERATE_OPTIONS)).rejects.toThrow('Auth failure');
    });

    it('throws when response content is empty instead of collapsing to ""', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
        model: 'gpt-test-model',
      });

      const provider = new OpenAiProvider(BASE_CONFIG);
      await expect(provider.generate('Prompt', GENERATE_OPTIONS)).rejects.toThrow(
        /empty response/i,
      );
    });

    it('throws when finish_reason is content_filter', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'partial' }, finish_reason: 'content_filter' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        model: 'gpt-test-model',
      });

      const provider = new OpenAiProvider(BASE_CONFIG);
      await expect(provider.generate('Prompt', GENERATE_OPTIONS)).rejects.toThrow(
        /content filter/i,
      );
    });

    it('clamps out-of-range temperature and maxTokens before calling the API', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
        model: 'gpt-test-model',
      });

      const provider = new OpenAiProvider(BASE_CONFIG);
      await provider.generate('Prompt', { maxTokens: -5, temperature: 9 });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBeLessThanOrEqual(1);
      expect(callArgs.temperature).toBeGreaterThanOrEqual(0);
      expect(callArgs.max_tokens).toBeGreaterThanOrEqual(1);
    });

    it('includes system prompt in messages when provided', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 5 },
        model: 'gpt-test-model',
      });

      const provider = new OpenAiProvider(BASE_CONFIG);
      await provider.generate('User message', GENERATE_OPTIONS);

      const callArgs = mockCreate.mock.calls[0][0];
      const messages = callArgs.messages as Array<{ role: string; content: string }>;
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
    });
  });

  describe('isAvailable()', () => {
    beforeEach(async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockReset();
    });

    it('returns true when API responds successfully', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        model: 'gpt-test-model',
      });

      const provider = new OpenAiProvider(BASE_CONFIG);
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns false when API throws', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockRejectedValueOnce(new Error('Unauthorized'));

      const provider = new OpenAiProvider(BASE_CONFIG);
      expect(await provider.isAvailable()).toBe(false);
    });
  });
});
