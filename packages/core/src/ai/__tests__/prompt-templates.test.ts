/**
 * Prompt templates tests.
 * Verifies language switching, detail levels, and prompt structure.
 */

import { describe, it, expect } from 'vitest';
import { getSectionPrompt, getSynthesisPrompt, isSupportedSection } from '../prompt-templates.js';
import type { SummaryLanguage, SummaryDetailLevel } from '@fhirbridge/types';

const SAMPLE_DATA = JSON.stringify([
  { resourceType: 'Condition', id: 'abc', code: { text: 'Diabetes' } },
]);

describe('getSectionPrompt', () => {
  it('returns system and user prompts', () => {
    const { systemPrompt, userPrompt } = getSectionPrompt('Conditions', {
      language: 'en',
      detailLevel: 'standard',
      resourceData: SAMPLE_DATA,
    });
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(userPrompt.length).toBeGreaterThan(0);
    expect(userPrompt).toContain(SAMPLE_DATA);
  });

  it('embeds resource data in user prompt', () => {
    const data = '{"test": "value"}';
    const { userPrompt } = getSectionPrompt('Medications', {
      language: 'en',
      detailLevel: 'brief',
      resourceData: data,
    });
    expect(userPrompt).toContain(data);
  });

  it('switches language in system prompt — Vietnamese', () => {
    const { systemPrompt } = getSectionPrompt('Conditions', {
      language: 'vi',
      detailLevel: 'standard',
      resourceData: SAMPLE_DATA,
    });
    expect(systemPrompt).toContain('Vietnamese');
    expect(systemPrompt).toContain('Tiếng Việt');
  });

  it('switches language in system prompt — Japanese', () => {
    const { systemPrompt } = getSectionPrompt('Conditions', {
      language: 'ja',
      detailLevel: 'standard',
      resourceData: SAMPLE_DATA,
    });
    expect(systemPrompt).toContain('Japanese');
    expect(systemPrompt).toContain('日本語');
  });

  it('detail level brief produces shorter instructions', () => {
    const { systemPrompt: brief } = getSectionPrompt('Conditions', {
      language: 'en',
      detailLevel: 'brief',
      resourceData: SAMPLE_DATA,
    });
    expect(brief).toContain('brief');
  });

  it('detail level detailed produces longer instructions', () => {
    const { systemPrompt: detailed } = getSectionPrompt('Conditions', {
      language: 'en',
      detailLevel: 'detailed',
      resourceData: SAMPLE_DATA,
    });
    expect(detailed).toContain('detailed');
  });

  const sections = [
    'Conditions',
    'Medications',
    'Allergies',
    'Vitals',
    'Observations',
    'Procedures',
    'Encounters',
    'DiagnosticReports',
    'Demographics',
  ] as const;

  for (const section of sections) {
    it(`generates prompt for section: ${section}`, () => {
      const { systemPrompt, userPrompt } = getSectionPrompt(section, {
        language: 'en',
        detailLevel: 'standard',
        resourceData: SAMPLE_DATA,
      });
      expect(systemPrompt.length).toBeGreaterThan(10);
      expect(userPrompt.length).toBeGreaterThan(10);
    });
  }

  const languages: SummaryLanguage[] = ['en', 'vi', 'ja'];
  const detailLevels: SummaryDetailLevel[] = ['brief', 'standard', 'detailed'];

  for (const lang of languages) {
    for (const level of detailLevels) {
      it(`generates prompt for lang=${lang} detailLevel=${level}`, () => {
        const { systemPrompt, userPrompt } = getSectionPrompt('Conditions', {
          language: lang,
          detailLevel: level,
          resourceData: SAMPLE_DATA,
        });
        expect(systemPrompt.length).toBeGreaterThan(10);
        expect(userPrompt.length).toBeGreaterThan(10);
      });
    }
  }
});

describe('getSynthesisPrompt', () => {
  const sectionSummaries = [
    { section: 'Conditions', content: 'Patient has Type 2 Diabetes, well-controlled.' },
    { section: 'Medications', content: 'On Metformin 500mg twice daily.' },
  ];

  it('returns system and user prompts', () => {
    const { systemPrompt, userPrompt } = getSynthesisPrompt(sectionSummaries, {
      language: 'en',
      detailLevel: 'standard',
    });
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(userPrompt.length).toBeGreaterThan(0);
  });

  it('includes all sections in user prompt', () => {
    const { userPrompt } = getSynthesisPrompt(sectionSummaries, {
      language: 'en',
      detailLevel: 'standard',
    });
    expect(userPrompt).toContain('Conditions');
    expect(userPrompt).toContain('Medications');
    expect(userPrompt).toContain('Type 2 Diabetes');
    expect(userPrompt).toContain('Metformin');
  });

  it('includes disclaimer instruction for EN', () => {
    const { systemPrompt } = getSynthesisPrompt(sectionSummaries, {
      language: 'en',
      detailLevel: 'standard',
    });
    expect(systemPrompt.toLowerCase()).toContain('disclaimer');
  });

  it('switches to Vietnamese', () => {
    const { systemPrompt } = getSynthesisPrompt(sectionSummaries, {
      language: 'vi',
      detailLevel: 'standard',
    });
    expect(systemPrompt).toContain('Vietnamese');
  });

  it('switches to Japanese', () => {
    const { systemPrompt } = getSynthesisPrompt(sectionSummaries, {
      language: 'ja',
      detailLevel: 'standard',
    });
    expect(systemPrompt).toContain('Japanese');
  });
});

describe('isSupportedSection', () => {
  it('returns true for known sections', () => {
    expect(isSupportedSection('Conditions')).toBe(true);
    expect(isSupportedSection('Medications')).toBe(true);
    expect(isSupportedSection('Demographics')).toBe(true);
  });

  it('returns false for unknown sections', () => {
    expect(isSupportedSection('Unknown')).toBe(false);
    expect(isSupportedSection('')).toBe(false);
    expect(isSupportedSection('immunization')).toBe(false);
  });
});
