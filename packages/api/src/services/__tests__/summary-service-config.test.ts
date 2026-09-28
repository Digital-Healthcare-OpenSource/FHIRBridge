/**
 * SummaryService must configure the AI provider from the injected settings (the
 * validated ApiConfig the route also checks) — never from process.env — so an
 * accepted job cannot start without the key the route saw.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as Core from '@fhirbridge/core';
import type { Bundle, SummaryConfig } from '@fhirbridge/types';

const captured: SummaryConfig[] = [];

vi.mock('@fhirbridge/core', async (importOriginal) => {
  const actual = await importOriginal<typeof Core>();
  return {
    ...actual,
    ProviderGateway: vi.fn().mockImplementation((config: SummaryConfig) => {
      captured.push(config);
      return { summarize: vi.fn().mockRejectedValue(new Error('stop here')) };
    }),
  };
});

const { SummaryService, summaryAiSettings } = await import('../summary-service.js');

const BUNDLE: Bundle = { resourceType: 'Bundle', type: 'collection', entry: [] };
const ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_MODEL', 'OPENAI_MODEL'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  captured.length = 0;
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // Decoys: the service must ignore these.
  process.env['ANTHROPIC_API_KEY'] = 'env-anthropic-key-should-be-ignored';
  process.env['ANTHROPIC_MODEL'] = 'env-model-should-be-ignored';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function generate(
  svc: InstanceType<typeof SummaryService>,
  provider: 'claude' | 'openai',
): Promise<SummaryConfig> {
  await svc.startGeneration({
    bundle: BUNDLE,
    hmacSecret: 'h'.repeat(32),
    userId: 'u1',
    summaryConfig: { provider },
  });
  await vi.waitFor(() => expect(captured.length).toBeGreaterThan(0));
  return captured[0]!;
}

describe('SummaryService AI settings source of truth', () => {
  it('uses the injected Claude key and model, not process.env', async () => {
    const svc = new SummaryService(undefined, undefined, undefined, {
      anthropicApiKey: 'config-anthropic-key',
      anthropicModel: 'config-claude-model',
    });
    const config = await generate(svc, 'claude');
    expect(config.providerConfig.apiKey).toBe('config-anthropic-key');
    expect(config.providerConfig.model).toBe('config-claude-model');
  });

  it('falls back to the core default model and uses the OpenAI key for openai', async () => {
    const svc = new SummaryService(undefined, undefined, undefined, {
      openaiApiKey: 'config-openai-key',
    });
    const config = await generate(svc, 'openai');
    expect(config.providerConfig.provider).toBe('openai');
    expect(config.providerConfig.apiKey).toBe('config-openai-key');
    expect(config.providerConfig.model).toBeTruthy();
    expect(config.providerConfig.model).not.toBe('env-model-should-be-ignored');
  });

  it('summaryAiSettings picks exactly the provider fields from an ApiConfig', () => {
    expect(
      summaryAiSettings({
        anthropicApiKey: 'a',
        openaiApiKey: 'o',
        anthropicModel: 'm1',
        openaiModel: 'm2',
        ...({ jwtSecret: 'not-copied' } as object),
      }),
    ).toEqual({ anthropicApiKey: 'a', openaiApiKey: 'o', anthropicModel: 'm1', openaiModel: 'm2' });
  });
});
