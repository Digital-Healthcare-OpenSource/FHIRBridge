/**
 * Summary formatter tests.
 * Verifies Markdown output structure and FHIR Composition validity.
 */

import { describe, it, expect } from 'vitest';
import { formatMarkdown, formatComposition } from '../summary-formatter.js';
import type { PatientSummary } from '@fhirbridge/types';

/** Build a minimal PatientSummary for testing */
function buildTestSummary(overrides?: Partial<PatientSummary>): PatientSummary {
  return {
    sections: [
      {
        section: 'Conditions',
        content: 'Patient has Type 2 Diabetes, well-controlled.',
        tokenCount: 150,
        resourceCount: 2,
      },
      {
        section: 'Medications',
        content: 'On Metformin 500mg twice daily.',
        tokenCount: 80,
        resourceCount: 1,
      },
      {
        section: 'Allergies',
        content: 'No data available for this section.',
        tokenCount: 10,
        resourceCount: 0,
      },
    ],
    synthesis: 'This patient has a well-managed Type 2 Diabetes case on Metformin.',
    metadata: {
      generatedAt: '2024-01-15T10:00:00Z',
      provider: 'claude',
      model: 'claude-sonnet-4-20250514',
      totalTokens: 240,
      language: 'en',
      deidentified: true,
    },
    ...overrides,
  };
}

describe('formatMarkdown', () => {
  it('returns a non-empty string', () => {
    const result = formatMarkdown(buildTestSummary());
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes main title', () => {
    const md = formatMarkdown(buildTestSummary());
    expect(md).toContain('# Patient Summary Report');
  });

  it('includes synthesis section', () => {
    const md = formatMarkdown(buildTestSummary());
    expect(md).toContain('## Clinical Narrative');
    expect(md).toContain('Type 2 Diabetes case on Metformin');
  });

  it('includes all section headers', () => {
    const md = formatMarkdown(buildTestSummary());
    expect(md).toContain('### Conditions');
    expect(md).toContain('### Medications');
    expect(md).toContain('### Allergies');
  });

  it('includes section content', () => {
    const md = formatMarkdown(buildTestSummary());
    expect(md).toContain('Type 2 Diabetes, well-controlled');
    expect(md).toContain('Metformin 500mg twice daily');
  });

  it('includes metadata (provider, model, tokens)', () => {
    const md = formatMarkdown(buildTestSummary());
    expect(md).toContain('claude');
    expect(md).toContain('claude-sonnet-4-20250514');
    expect(md).toContain('240');
  });

  it('includes AI disclaimer', () => {
    const md = formatMarkdown(buildTestSummary());
    expect(md.toLowerCase()).toContain('disclaimer');
  });

  it('includes deidentified marker', () => {
    const md = formatMarkdown(buildTestSummary());
    expect(md).toContain('Yes'); // deidentified: true → "Yes"
  });

  it('shows resource count for non-empty sections', () => {
    const md = formatMarkdown(buildTestSummary());
    expect(md).toContain('2 resource(s)');
  });

  it('produces valid markdown with sections separator', () => {
    const md = formatMarkdown(buildTestSummary());
    expect(md).toContain('---');
  });
});

describe('formatComposition', () => {
  it('returns a FHIR Composition resource', () => {
    const comp = formatComposition(buildTestSummary(), 'Patient/[PATIENT]');
    expect(comp.resourceType).toBe('Composition');
  });

  it('has correct status', () => {
    const comp = formatComposition(buildTestSummary(), 'Patient/[PATIENT]');
    expect(comp.status).toBe('preliminary');
  });

  it('has correct LOINC code for summary note', () => {
    const comp = formatComposition(buildTestSummary(), 'Patient/[PATIENT]');
    expect(comp.type.coding[0]?.system).toBe('http://loinc.org');
    expect(comp.type.coding[0]?.code).toBe('34133-9');
  });

  it('sets subject reference', () => {
    const comp = formatComposition(buildTestSummary(), 'Patient/[PATIENT]');
    expect(comp.subject?.reference).toBe('Patient/[PATIENT]');
  });

  it('includes synthesis + all sections + disclaimer in Composition sections', () => {
    const comp = formatComposition(buildTestSummary(), 'Patient/[PATIENT]');
    // synthesis + 3 sections + trailing disclaimer = 5
    expect(comp.section.length).toBe(5);
    const titles = comp.section.map((s) => s.title);
    expect(titles).toContain('Clinical Narrative');
    expect(titles).toContain('Conditions');
    expect(titles).toContain('Medications');
    expect(titles).toContain('Allergies');
    expect(titles).toContain('Disclaimer');
  });

  it('includes a clinician-review disclaimer section', () => {
    const comp = formatComposition(buildTestSummary(), 'Patient/[PATIENT]');
    const disclaimerSection = comp.section.find((s) => s.title === 'Disclaimer');
    expect(disclaimerSection).toBeDefined();
    expect(disclaimerSection!.text.div.toLowerCase()).toContain('clinician');
  });

  it('prefers metadata.disclaimer when set', () => {
    const summary = buildTestSummary();
    summary.metadata.disclaimer = 'CUSTOM shifted-date disclaimer for this run.';
    const comp = formatComposition(summary, 'Patient/[PATIENT]');
    const disclaimerSection = comp.section.find((s) => s.title === 'Disclaimer');
    expect(disclaimerSection!.text.div).toContain('CUSTOM shifted-date disclaimer');
  });

  it('surfaces a truncated section warning in the section div', () => {
    const summary = buildTestSummary();
    summary.sections[0]!.truncated = true;
    const comp = formatComposition(summary, 'Patient/[PATIENT]');
    const cond = comp.section.find((s) => s.title === 'Conditions');
    expect(cond!.text.div.toLowerCase()).toContain('truncated');
  });

  it('surfaces excluded resource types in the disclaimer section', () => {
    const summary = buildTestSummary();
    summary.sections[0]!.excludedResourceTypes = ['ServiceRequest', 'FamilyMemberHistory'];
    const comp = formatComposition(summary, 'Patient/[PATIENT]');
    const disclaimerSection = comp.section.find((s) => s.title === 'Disclaimer');
    expect(disclaimerSection!.text.div).toContain('ServiceRequest');
  });

  it('localizes headings and disclaimer for Vietnamese', () => {
    const summary = buildTestSummary();
    summary.metadata.language = 'vi';
    const md = formatMarkdown(summary);
    expect(md).toContain('Báo cáo Tóm tắt Bệnh nhân');
    expect(md).toContain('Tuyên bố miễn trừ');
  });

  it('each section has valid FHIR narrative div', () => {
    const comp = formatComposition(buildTestSummary(), 'Patient/[PATIENT]');
    for (const section of comp.section) {
      expect(section.text.status).toBe('generated');
      expect(section.text.div).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    }
  });

  it('includes date from metadata', () => {
    const comp = formatComposition(buildTestSummary(), 'Patient/[PATIENT]');
    expect(comp.date).toBe('2024-01-15T10:00:00Z');
  });

  it('includes AI author attribution', () => {
    const comp = formatComposition(buildTestSummary(), 'Patient/[PATIENT]');
    expect(comp.author[0]?.display).toContain('claude');
  });

  it('escapes HTML in section content', () => {
    const summary = buildTestSummary({
      synthesis: 'Blood sugar <100 mg/dL & glucose "normal"',
    });
    const comp = formatComposition(summary, 'Patient/[PATIENT]');
    const narrativeSection = comp.section[0]!;
    expect(narrativeSection.text.div).toContain('&lt;100');
    expect(narrativeSection.text.div).toContain('&amp;');
  });

  it('works with empty patient ref', () => {
    const comp = formatComposition(buildTestSummary(), '');
    // subject should be undefined when ref is empty
    expect(comp.subject).toBeUndefined();
  });
});
