/**
 * Synthesis engine tests.
 * Verifies that section summaries are combined into a narrative and
 * that language/detail level settings affect the prompt.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AiProvider } from '../ai-provider-interface.js';
import type { AiResponse, GenerateOptions, SectionSummary, SummaryConfig } from '@fhirbridge/types';
import { TokenTracker } from '../token-tracker.js';
import { synthesize } from '../synthesis-engine.js';

/** Captures the last prompt seen by the stub */
let lastPromptSeen = '';
let lastSystemPromptSeen = '';

const capturingProvider: AiProvider = {
  name: 'stub',
  model: 'stub-model',
  async generate(prompt: string, options: GenerateOptions): Promise<AiResponse> {
    lastPromptSeen = prompt;
    lastSystemPromptSeen = options.systemPrompt ?? '';
    return {
      content: 'synthesized patient narrative',
      tokenUsage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      model: 'stub-model',
      finishReason: 'stop',
    };
  },
  async isAvailable(): Promise<boolean> {
    return true;
  },
};

function makeConfig(overrides: Partial<SummaryConfig> = {}): SummaryConfig {
  return {
    language: 'en',
    detailLevel: 'standard',
    outputFormats: ['markdown'],
    providerConfig: {
      provider: 'claude',
      model: 'stub',
      apiKey: 'key',
      maxTokens: 512,
      temperature: 0.2,
    },
    hmacSecret: 'test-secret',
    ...overrides,
  };
}

function makeSections(overrides?: Partial<SectionSummary>[]): SectionSummary[] {
  const defaults: SectionSummary[] = [
    {
      section: 'Conditions',
      content: 'Patient has hypertension.',
      tokenCount: 30,
      resourceCount: 1,
    },
    { section: 'Medications', content: 'Lisinopril 10mg daily.', tokenCount: 25, resourceCount: 1 },
    {
      section: 'Allergies',
      content: 'Penicillin allergy — anaphylaxis.',
      tokenCount: 20,
      resourceCount: 1,
    },
  ];
  if (!overrides) return defaults;
  return defaults.map((d, i) => ({ ...d, ...(overrides[i] ?? {}) }));
}

describe('synthesize', () => {
  describe('basic behavior', () => {
    it('returns a string narrative', async () => {
      const tracker = new TokenTracker();
      const result = await synthesize(makeSections(), capturingProvider, makeConfig(), tracker);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns fallback string when all sections are empty', async () => {
      const emptySections: SectionSummary[] = [
        { section: 'Conditions', content: 'No data available', tokenCount: 0, resourceCount: 0 },
        {
          section: 'Medications',
          content: 'No data available for this section.',
          tokenCount: 0,
          resourceCount: 0,
        },
      ];
      const tracker = new TokenTracker();
      const result = await synthesize(emptySections, capturingProvider, makeConfig(), tracker);
      expect(result).toBe('Insufficient data available to generate a patient summary.');
    });

    it('filters out empty sections (resourceCount 0) before synthesis', async () => {
      const mixed: SectionSummary[] = [
        { section: 'Conditions', content: 'Hypertension', tokenCount: 20, resourceCount: 1 },
        {
          section: 'Medications',
          content: 'No data available for this section.',
          tokenCount: 0,
          resourceCount: 0,
        },
      ];
      const tracker = new TokenTracker();
      await synthesize(mixed, capturingProvider, makeConfig(), tracker);

      // Only "Conditions" should appear in the prompt, not the empty "Medications"
      expect(lastPromptSeen).toContain('Conditions');
      expect(lastPromptSeen).not.toContain('No data available');
    });

    it('keeps a real section whose narrative legitimately contains "No data available"', async () => {
      // resourceCount > 0 → this is a real summary, even though the phrase appears
      const sections: SectionSummary[] = [
        {
          section: 'Observations',
          content: 'CBC reviewed. No data available for platelet count; other values normal.',
          tokenCount: 40,
          resourceCount: 3,
        },
      ];
      const tracker = new TokenTracker();
      await synthesize(sections, capturingProvider, makeConfig(), tracker);

      // The section must NOT be filtered out — its content reaches the prompt
      expect(lastPromptSeen).toContain('platelet count');
    });

    it('appends an UNVERIFIED marker for dosage values absent from the source', async () => {
      const hallucinatingProvider: AiProvider = {
        name: 'stub',
        model: 'stub-model',
        async generate(): Promise<AiResponse> {
          return {
            content: 'Patient takes Lisinopril 20mg daily.',
            tokenUsage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
            model: 'stub-model',
            finishReason: 'stop',
          };
        },
        async isAvailable(): Promise<boolean> {
          return true;
        },
      };
      // Source section only mentions 10mg — 20mg is invented by the model
      const sections: SectionSummary[] = [
        {
          section: 'Medications',
          content: 'Lisinopril 10mg daily.',
          tokenCount: 20,
          resourceCount: 1,
        },
      ];
      const tracker = new TokenTracker();
      const result = await synthesize(sections, hallucinatingProvider, makeConfig(), tracker);
      expect(result).toContain('UNVERIFIED');
      expect(result).toContain('20mg');
    });

    it('does not flag dosage values that are present in the source', async () => {
      const faithfulProvider: AiProvider = {
        name: 'stub',
        model: 'stub-model',
        async generate(): Promise<AiResponse> {
          return {
            content: 'Patient takes Lisinopril 10 mg daily.',
            tokenUsage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
            model: 'stub-model',
            finishReason: 'stop',
          };
        },
        async isAvailable(): Promise<boolean> {
          return true;
        },
      };
      const sections: SectionSummary[] = [
        {
          section: 'Medications',
          content: 'Lisinopril 10mg daily.',
          tokenCount: 20,
          resourceCount: 1,
        },
      ];
      const tracker = new TokenTracker();
      const result = await synthesize(sections, faithfulProvider, makeConfig(), tracker);
      expect(result).not.toContain('UNVERIFIED');
    });

    it('tracks tokens in TokenTracker', async () => {
      const tracker = new TokenTracker();
      await synthesize(makeSections(), capturingProvider, makeConfig(), tracker);
      const usage = tracker.getUsage();
      expect(usage.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('language parameter', () => {
    it('includes Vietnamese language instruction in system prompt for vi', async () => {
      const tracker = new TokenTracker();
      await synthesize(makeSections(), capturingProvider, makeConfig({ language: 'vi' }), tracker);
      expect(lastSystemPromptSeen).toContain('Vietnamese');
    });

    it('includes Japanese language instruction in system prompt for ja', async () => {
      const tracker = new TokenTracker();
      await synthesize(makeSections(), capturingProvider, makeConfig({ language: 'ja' }), tracker);
      expect(lastSystemPromptSeen).toContain('Japanese');
    });

    it('includes English instruction for default en language', async () => {
      const tracker = new TokenTracker();
      await synthesize(makeSections(), capturingProvider, makeConfig({ language: 'en' }), tracker);
      expect(lastSystemPromptSeen).toContain('English');
    });
  });

  describe('detail level parameter', () => {
    it('includes "brief" instruction in system prompt for brief detail level', async () => {
      const tracker = new TokenTracker();
      await synthesize(
        makeSections(),
        capturingProvider,
        makeConfig({ detailLevel: 'brief' }),
        tracker,
      );
      expect(lastSystemPromptSeen).toContain('brief');
    });

    it('includes "detailed" instruction in system prompt for detailed detail level', async () => {
      const tracker = new TokenTracker();
      await synthesize(
        makeSections(),
        capturingProvider,
        makeConfig({ detailLevel: 'detailed' }),
        tracker,
      );
      expect(lastSystemPromptSeen).toContain('detailed');
    });
  });

  describe('section content in prompt', () => {
    it('includes each meaningful section in the user prompt', async () => {
      const tracker = new TokenTracker();
      await synthesize(makeSections(), capturingProvider, makeConfig(), tracker);
      expect(lastPromptSeen).toContain('Conditions');
      expect(lastPromptSeen).toContain('Medications');
      expect(lastPromptSeen).toContain('Allergies');
    });
  });
});
