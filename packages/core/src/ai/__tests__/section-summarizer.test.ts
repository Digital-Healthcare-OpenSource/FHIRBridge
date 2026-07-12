/**
 * Section summarizer tests.
 * Verifies resource grouping by type and prompt generation using a stub AI provider.
 */

import { describe, it, expect } from 'vitest';
import type { AiProvider } from '../ai-provider-interface.js';
import type {
  AiResponse,
  GenerateOptions,
  DeidentifiedBundle,
  SummaryConfig,
} from '@fhirbridge/types';
import { TokenTracker } from '../token-tracker.js';
import { summarizeSections } from '../section-summarizer.js';

/** Stub provider returning fixed text */
const stubProvider: AiProvider = {
  name: 'stub',
  model: 'stub-model',
  async generate(_prompt: string, _options: GenerateOptions): Promise<AiResponse> {
    return {
      content: 'stub section summary',
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      model: 'stub-model',
      finishReason: 'stop',
    };
  },
  async isAvailable(): Promise<boolean> {
    return true;
  },
};

const BASE_CONFIG: SummaryConfig = {
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
};

/** Helper: mark a bundle as deidentified (cast) */
function asDeidentified(bundle: object): DeidentifiedBundle {
  return { ...bundle, _deidentified: true as const } as DeidentifiedBundle;
}

/** Build a bundle with specific resource types */
function buildBundle(resources: Array<Record<string, unknown>>): DeidentifiedBundle {
  return asDeidentified({
    resourceType: 'Bundle',
    type: 'collection',
    entry: resources.map((r) => ({ resource: r })),
  });
}

describe('summarizeSections', () => {
  it('returns SectionSummary[] with all standard section names', async () => {
    const bundle = buildBundle([]);
    const tracker = new TokenTracker();

    const results = await summarizeSections(bundle, stubProvider, BASE_CONFIG, tracker);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    const sectionNames = results.map((s) => s.section);
    expect(sectionNames).toContain('Conditions');
    expect(sectionNames).toContain('Medications');
    expect(sectionNames).toContain('Allergies');
    expect(sectionNames).toContain('Observations');
    expect(sectionNames).toContain('Procedures');
    expect(sectionNames).toContain('Encounters');
    expect(sectionNames).toContain('DiagnosticReports');
  });

  it('produces "No data available" for empty sections', async () => {
    const bundle = buildBundle([]);
    const tracker = new TokenTracker();

    const results = await summarizeSections(bundle, stubProvider, BASE_CONFIG, tracker);

    const conditionSection = results.find((s) => s.section === 'Conditions');
    expect(conditionSection).toBeDefined();
    expect(conditionSection!.content).toContain('No data available');
    expect(conditionSection!.resourceCount).toBe(0);
  });

  it('calls provider.generate for sections with resources', async () => {
    const bundle = buildBundle([
      { resourceType: 'Condition', id: 'c1', subject: { reference: 'Patient/p1' } },
      { resourceType: 'MedicationRequest', id: 'm1', subject: { reference: 'Patient/p1' } },
    ]);
    const tracker = new TokenTracker();

    const results = await summarizeSections(bundle, stubProvider, BASE_CONFIG, tracker);

    const condSection = results.find((s) => s.section === 'Conditions');
    expect(condSection!.content).toBe('stub section summary');
    expect(condSection!.resourceCount).toBe(1);

    const medSection = results.find((s) => s.section === 'Medications');
    expect(medSection!.content).toBe('stub section summary');
    expect(medSection!.resourceCount).toBe(1);
  });

  it('groups MedicationStatement into Medications section', async () => {
    const bundle = buildBundle([
      { resourceType: 'MedicationStatement', id: 'ms1', subject: { reference: 'Patient/p1' } },
    ]);
    const tracker = new TokenTracker();

    const results = await summarizeSections(bundle, stubProvider, BASE_CONFIG, tracker);
    const medSection = results.find((s) => s.section === 'Medications');
    expect(medSection!.resourceCount).toBe(1);
  });

  it('groups AllergyIntolerance into Allergies section', async () => {
    const bundle = buildBundle([
      { resourceType: 'AllergyIntolerance', id: 'a1', patient: { reference: 'Patient/p1' } },
    ]);
    const tracker = new TokenTracker();

    const results = await summarizeSections(bundle, stubProvider, BASE_CONFIG, tracker);
    const allergySection = results.find((s) => s.section === 'Allergies');
    expect(allergySection!.resourceCount).toBe(1);
  });

  it('separates vital sign Observations into Vitals section', async () => {
    const vitalObservation = {
      resourceType: 'Observation',
      id: 'obs-vital',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'vital-signs',
            },
          ],
        },
      ],
    };
    const labObservation = {
      resourceType: 'Observation',
      id: 'obs-lab',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'laboratory',
            },
          ],
        },
      ],
    };

    const bundle = buildBundle([vitalObservation, labObservation]);
    const tracker = new TokenTracker();

    const results = await summarizeSections(bundle, stubProvider, BASE_CONFIG, tracker);
    const vitalsSection = results.find((s) => s.section === 'Vitals');
    const obsSection = results.find((s) => s.section === 'Observations');

    expect(vitalsSection!.resourceCount).toBe(1);
    expect(obsSection!.resourceCount).toBe(1);
  });

  it('tracks tokens via TokenTracker for sections with data', async () => {
    const bundle = buildBundle([{ resourceType: 'Condition', id: 'c1' }]);
    const tracker = new TokenTracker();

    await summarizeSections(bundle, stubProvider, BASE_CONFIG, tracker);

    const usage = tracker.getUsage();
    expect(usage.totalTokens).toBeGreaterThan(0);
  });

  it('groups MedicationAdministration and MedicationDispense into Medications', async () => {
    const bundle = buildBundle([
      { resourceType: 'MedicationAdministration', id: 'ma1' },
      { resourceType: 'MedicationDispense', id: 'md1' },
    ]);
    const tracker = new TokenTracker();

    const results = await summarizeSections(bundle, stubProvider, BASE_CONFIG, tracker);
    const medSection = results.find((s) => s.section === 'Medications');
    expect(medSection!.resourceCount).toBe(2);
  });

  it('maps Immunization into its own Immunizations section', async () => {
    const bundle = buildBundle([{ resourceType: 'Immunization', id: 'imm1' }]);
    const tracker = new TokenTracker();

    const results = await summarizeSections(bundle, stubProvider, BASE_CONFIG, tracker);
    const immSection = results.find((s) => s.section === 'Immunizations');
    expect(immSection).toBeDefined();
    expect(immSection!.resourceCount).toBe(1);
  });

  it('records unmapped resource types in excludedResourceTypes', async () => {
    const bundle = buildBundle([
      { resourceType: 'Condition', id: 'c1' },
      { resourceType: 'FamilyMemberHistory', id: 'fmh1' },
      { resourceType: 'ServiceRequest', id: 'sr1' },
      { resourceType: 'ServiceRequest', id: 'sr2' },
    ]);
    const tracker = new TokenTracker();

    const results = await summarizeSections(bundle, stubProvider, BASE_CONFIG, tracker);
    const excluded = results.flatMap((s) => s.excludedResourceTypes ?? []);
    expect(excluded).toContain('FamilyMemberHistory');
    expect(excluded).toContain('ServiceRequest');
    // Distinct — ServiceRequest recorded once, not twice
    expect(excluded.filter((t) => t === 'ServiceRequest')).toHaveLength(1);
  });

  it('sets truncated=true on a section when the provider hits max_tokens', async () => {
    const truncatingProvider: AiProvider = {
      name: 'stub',
      model: 'stub-model',
      async generate(): Promise<AiResponse> {
        return {
          content: 'partial summary',
          tokenUsage: { inputTokens: 10, outputTokens: 512, totalTokens: 522 },
          model: 'stub-model',
          finishReason: 'max_tokens',
        };
      },
      async isAvailable(): Promise<boolean> {
        return true;
      },
    };
    const bundle = buildBundle([{ resourceType: 'Condition', id: 'c1' }]);
    const tracker = new TokenTracker();

    const results = await summarizeSections(bundle, truncatingProvider, BASE_CONFIG, tracker);
    const condSection = results.find((s) => s.section === 'Conditions');
    expect(condSection!.truncated).toBe(true);

    // Empty sections are complete, not truncated
    const proc = results.find((s) => s.section === 'Procedures');
    expect(proc!.truncated).toBeUndefined();
  });
});
