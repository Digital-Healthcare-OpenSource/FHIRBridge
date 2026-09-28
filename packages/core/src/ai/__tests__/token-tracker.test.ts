/**
 * Token tracker tests.
 * Verifies accumulation, cost estimation, and budget tracking.
 */

import { describe, it, expect, vi } from 'vitest';
import { TokenTracker } from '../token-tracker.js';

describe('TokenTracker', () => {
  describe('track and getUsage', () => {
    it('starts with zero usage', () => {
      const tracker = new TokenTracker();
      const usage = tracker.getUsage();
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.estimatedCostUsd).toBe(0);
      expect(usage.records).toHaveLength(0);
    });

    it('accumulates token counts', () => {
      const tracker = new TokenTracker();
      tracker.track('claude', 'claude-sonnet-4-20250514', 'Conditions', 500, 200);
      tracker.track('claude', 'claude-sonnet-4-20250514', 'Medications', 300, 150);

      const usage = tracker.getUsage();
      expect(usage.inputTokens).toBe(800);
      expect(usage.outputTokens).toBe(350);
      expect(usage.totalTokens).toBe(1150);
    });

    it('accumulates multiple providers', () => {
      const tracker = new TokenTracker();
      tracker.track('claude', 'claude-sonnet-4-20250514', 'Conditions', 400, 100);
      tracker.track('openai', 'gpt-4o', 'Medications', 200, 80);

      const usage = tracker.getUsage();
      expect(usage.inputTokens).toBe(600);
      expect(usage.outputTokens).toBe(180);
      expect(usage.records).toHaveLength(2);
    });

    it('records include section and model info', () => {
      const tracker = new TokenTracker();
      tracker.track('claude', 'claude-sonnet-4-20250514', 'Conditions', 500, 200);

      const { records } = tracker.getUsage();
      expect(records[0]?.section).toBe('Conditions');
      expect(records[0]?.model).toBe('claude-sonnet-4-20250514');
      expect(records[0]?.provider).toBe('claude');
    });

    it('returns copies of records (immutable)', () => {
      const tracker = new TokenTracker();
      tracker.track('claude', 'model', 'Conditions', 100, 50);

      const usage1 = tracker.getUsage();
      const usage2 = tracker.getUsage();
      expect(usage1.records).not.toBe(usage2.records);
    });
  });

  describe('cost estimation', () => {
    it('estimates cost for claude', () => {
      const tracker = new TokenTracker();
      tracker.track('claude', 'claude-opus-5', 'test', 1000, 1000);

      const { estimatedCostUsd, records } = tracker.getUsage();
      // input: 1000/1000 * 0.005 = 0.005, output: 1000/1000 * 0.025 = 0.025 → total: 0.030
      expect(records[0]?.estimatedCostUsd).toBeCloseTo(0.03, 5);
      expect(estimatedCostUsd).toBeCloseTo(0.03, 5);
    });

    it('estimates cost for openai', () => {
      const tracker = new TokenTracker();
      tracker.track('openai', 'gpt-4o', 'test', 1000, 1000);

      const { records } = tracker.getUsage();
      // input: 1000/1000 * 0.005 = 0.005, output: 1000/1000 * 0.015 = 0.015 → total: 0.020
      expect(records[0]?.estimatedCostUsd).toBeCloseTo(0.02, 5);
    });

    it('accumulates costs across records', () => {
      const tracker = new TokenTracker();
      tracker.track('claude', 'model', 'A', 1000, 1000);
      tracker.track('claude', 'model', 'B', 1000, 1000);

      const { estimatedCostUsd } = tracker.getUsage();
      expect(estimatedCostUsd).toBeCloseTo(0.06, 5);
    });
  });

  describe('getTotalTokens', () => {
    it('returns sum of all tokens', () => {
      const tracker = new TokenTracker();
      tracker.track('claude', 'model', 'A', 100, 50);
      tracker.track('openai', 'model', 'B', 200, 75);
      expect(tracker.getTotalTokens()).toBe(425);
    });

    it('returns 0 when empty', () => {
      expect(new TokenTracker().getTotalTokens()).toBe(0);
    });
  });

  describe('wouldExceedBudget', () => {
    it('returns false when under budget', () => {
      const tracker = new TokenTracker();
      tracker.track('claude', 'model', 'A', 1000, 500);
      expect(tracker.wouldExceedBudget(500, 5000)).toBe(false);
    });

    it('returns true when would exceed', () => {
      const tracker = new TokenTracker();
      tracker.track('claude', 'model', 'A', 4000, 500);
      expect(tracker.wouldExceedBudget(600, 5000)).toBe(true);
    });

    it('returns false when exactly at budget', () => {
      const tracker = new TokenTracker();
      tracker.track('claude', 'model', 'A', 2500, 2500);
      expect(tracker.wouldExceedBudget(0, 5000)).toBe(false);
    });
  });

  describe('budget warning', () => {
    it('writes to stderr when approaching budget', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      // budget of 1000, track 950 tokens → should warn (>90% of budget)
      const tracker = new TokenTracker(1000);
      tracker.track('claude', 'model', 'test', 500, 450);

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('WARNING'));

      stderrSpy.mockRestore();
    });

    it('does not warn when under 90% of budget', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const tracker = new TokenTracker(10000);
      tracker.track('claude', 'model', 'test', 100, 100);

      expect(stderrSpy).not.toHaveBeenCalled();

      stderrSpy.mockRestore();
    });
  });

  describe('reset', () => {
    it('clears all records', () => {
      const tracker = new TokenTracker();
      tracker.track('claude', 'model', 'A', 100, 50);
      tracker.track('openai', 'model', 'B', 200, 75);

      tracker.reset();
      const usage = tracker.getUsage();
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.records).toHaveLength(0);
    });
  });
});
