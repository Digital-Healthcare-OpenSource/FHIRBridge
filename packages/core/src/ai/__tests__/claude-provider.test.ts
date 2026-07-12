/**
 * Claude provider tests.
 * Verifies interface compliance and offline behavior (no real API calls).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeProvider, CLAUDE_DEFAULT_MODEL } from '../claude-provider.js';

// Mock the Anthropic SDK so no real HTTP calls occur
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const AnthropicMock = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  // Expose RateLimitError so the provider's isRateLimitError helper works
  AnthropicMock.RateLimitError = class RateLimitError extends Error {
    status = 429;
    constructor() {
      super('Rate limit exceeded');
    }
  };
  (AnthropicMock as unknown as Record<string, unknown>)._mockCreate = mockCreate;
  return { default: AnthropicMock };
});

async function getMockCreate() {
  const mod = await import('@anthropic-ai/sdk');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod.default as unknown as Record<string, any>)._mockCreate as ReturnType<typeof vi.fn>;
}

const BASE_CONFIG = {
  provider: 'claude' as const,
  model: 'claude-test-model',
  apiKey: 'test-api-key',
  maxTokens: 1024,
  temperature: 0.3,
};

const GENERATE_OPTIONS = {
  maxTokens: 1024,
  temperature: 0.3,
  systemPrompt: 'You are a test assistant.',
};

describe('ClaudeProvider', () => {
  describe('interface compliance', () => {
    it('has name === "claude"', () => {
      const provider = new ClaudeProvider(BASE_CONFIG);
      expect(provider.name).toBe('claude');
    });

    it('exposes model from config', () => {
      const provider = new ClaudeProvider(BASE_CONFIG);
      expect(provider.model).toBe('claude-test-model');
    });

    it('uses CLAUDE_DEFAULT_MODEL when no model specified', () => {
      const { model: _model, ...configWithoutModel } = BASE_CONFIG;
      const provider = new ClaudeProvider({ ...configWithoutModel, model: '' });
      expect(provider.model).toBe(CLAUDE_DEFAULT_MODEL);
    });

    it('has generate() and isAvailable() methods', () => {
      const provider = new ClaudeProvider(BASE_CONFIG);
      expect(typeof provider.generate).toBe('function');
      expect(typeof provider.isAvailable).toBe('function');
    });
  });

  describe('generate()', () => {
    beforeEach(async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockReset();
    });

    it('maps Anthropic response to AiResponse shape', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Summary result' }],
        usage: { input_tokens: 100, output_tokens: 50 },
        model: 'claude-test-model',
        stop_reason: 'end_turn',
      });

      const provider = new ClaudeProvider(BASE_CONFIG);
      const result = await provider.generate('Summarize this.', GENERATE_OPTIONS);

      expect(result.content).toBe('Summary result');
      expect(result.tokenUsage.inputTokens).toBe(100);
      expect(result.tokenUsage.outputTokens).toBe(50);
      expect(result.tokenUsage.totalTokens).toBe(150);
      expect(result.finishReason).toBe('stop');
    });

    it('sets finishReason to max_tokens when stop_reason is max_tokens', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Truncated' }],
        usage: { input_tokens: 200, output_tokens: 1024 },
        model: 'claude-test-model',
        stop_reason: 'max_tokens',
      });

      const provider = new ClaudeProvider(BASE_CONFIG);
      const result = await provider.generate('Prompt', GENERATE_OPTIONS);
      expect(result.finishReason).toBe('max_tokens');
    });

    it('throws when API call fails', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockRejectedValue(new Error('Auth failure'));

      const provider = new ClaudeProvider(BASE_CONFIG);
      await expect(provider.generate('Prompt', GENERATE_OPTIONS)).rejects.toThrow('Auth failure');
    });

    it('throws when response content is empty instead of collapsing to ""', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '   ' }],
        usage: { input_tokens: 10, output_tokens: 0 },
        model: 'claude-test-model',
        stop_reason: 'end_turn',
      });

      const provider = new ClaudeProvider(BASE_CONFIG);
      await expect(provider.generate('Prompt', GENERATE_OPTIONS)).rejects.toThrow(
        /empty response/i,
      );
    });

    it('throws when stop_reason is refusal', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'partial' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-test-model',
        stop_reason: 'refusal',
      });

      const provider = new ClaudeProvider(BASE_CONFIG);
      await expect(provider.generate('Prompt', GENERATE_OPTIONS)).rejects.toThrow(/refus/i);
    });

    it('clamps out-of-range temperature and maxTokens before calling the API', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 5, output_tokens: 2 },
        model: 'claude-test-model',
        stop_reason: 'end_turn',
      });

      const provider = new ClaudeProvider(BASE_CONFIG);
      await provider.generate('Prompt', { maxTokens: -5, temperature: 9 });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBeLessThanOrEqual(1);
      expect(callArgs.temperature).toBeGreaterThanOrEqual(0);
      expect(callArgs.max_tokens).toBeGreaterThanOrEqual(1);
    });

    it('concatenates multiple text blocks', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Part one. ' },
          { type: 'text', text: 'Part two.' },
        ],
        usage: { input_tokens: 50, output_tokens: 20 },
        model: 'claude-test-model',
        stop_reason: 'end_turn',
      });

      const provider = new ClaudeProvider(BASE_CONFIG);
      const result = await provider.generate('Prompt', GENERATE_OPTIONS);
      expect(result.content).toBe('Part one. Part two.');
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
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'claude-test-model',
        stop_reason: 'end_turn',
      });

      const provider = new ClaudeProvider(BASE_CONFIG);
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns false when API throws', async () => {
      const mockCreate = await getMockCreate();
      mockCreate.mockRejectedValueOnce(new Error('Unauthorized'));

      const provider = new ClaudeProvider(BASE_CONFIG);
      expect(await provider.isAvailable()).toBe(false);
    });
  });
});
