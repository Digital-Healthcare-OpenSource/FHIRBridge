/**
 * PDF formatter tests.
 * Verifies that formatPdf() produces a valid PDF Buffer.
 */

import { existsSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import type { PatientSummary } from '@fhirbridge/types';
import { fitsBuiltInPdfFont, formatPdf, PdfFontRequiredError } from '../pdf-formatter.js';

/** Build a minimal PatientSummary for testing */
function buildSummary(overrides: Partial<PatientSummary> = {}): PatientSummary {
  return {
    sections: [
      {
        section: 'Conditions',
        content: 'Patient has hypertension (I10), well controlled.',
        tokenCount: 40,
        resourceCount: 1,
      },
      {
        section: 'Medications',
        content: 'Lisinopril 10mg once daily.',
        tokenCount: 30,
        resourceCount: 1,
      },
    ],
    synthesis:
      'The patient is a middle-aged adult with hypertension managed with Lisinopril. No significant allergies reported.',
    metadata: {
      generatedAt: '2026-03-22T10:00:00.000Z',
      provider: 'claude',
      model: 'claude-sonnet-4-20250514',
      totalTokens: 500,
      language: 'en',
      deidentified: true,
    },
    ...overrides,
  };
}

describe('formatPdf', () => {
  it('returns a Buffer', async () => {
    const result = await formatPdf(buildSummary());
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('PDF starts with %PDF magic bytes', async () => {
    const result = await formatPdf(buildSummary());
    const header = result.subarray(0, 4).toString('ascii');
    expect(header).toBe('%PDF');
  });

  it('generates a non-trivial PDF (> 1000 bytes)', async () => {
    const result = await formatPdf(buildSummary());
    expect(result.length).toBeGreaterThan(1000);
  });

  it('handles empty sections array gracefully', async () => {
    const summary = buildSummary({ sections: [] });
    const result = await formatPdf(summary);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('handles empty synthesis string gracefully', async () => {
    const summary = buildSummary({ synthesis: '' });
    const result = await formatPdf(summary);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(1000);
  });

  it('handles sections with zero resourceCount', async () => {
    const summary = buildSummary({
      sections: [
        {
          section: 'Allergies',
          content: 'No data available for this section.',
          tokenCount: 0,
          resourceCount: 0,
        },
      ],
    });
    const result = await formatPdf(summary);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('includes content for multiple sections without errors', async () => {
    const summary = buildSummary({
      sections: [
        { section: 'Conditions', content: 'Diabetes Type 2.', tokenCount: 20, resourceCount: 2 },
        { section: 'Medications', content: 'Metformin 500mg.', tokenCount: 15, resourceCount: 1 },
        { section: 'Allergies', content: 'No known allergies.', tokenCount: 10, resourceCount: 0 },
        { section: 'Vitals', content: 'BP 130/80. HR 72.', tokenCount: 25, resourceCount: 5 },
        { section: 'Procedures', content: 'Annual checkup.', tokenCount: 12, resourceCount: 1 },
      ],
    });
    const result = await formatPdf(summary);
    expect(result.length).toBeGreaterThan(1000);
  });

  describe('non-Latin text (built-in font is WinAnsi-only)', () => {
    const vi = buildSummary({ synthesis: 'Bệnh nhân tăng huyết áp, điều trị ổn định.' });
    const ko = buildSummary({ synthesis: '환자는 고혈압으로 치료 중입니다.' });
    const ja = buildSummary({ synthesis: '患者は高血圧で治療中です。' });

    it('knows which text the built-in font can draw', () => {
      expect(fitsBuiltInPdfFont(buildSummary())).toBe(true);
      // cp1252 extras (dashes, curly quotes) and Latin-1 accents are fine
      expect(fitsBuiltInPdfFont(buildSummary({ synthesis: 'Café — “stable” ±' }))).toBe(true);
      for (const summary of [vi, ko, ja]) expect(fitsBuiltInPdfFont(summary)).toBe(false);
    });

    it('rejects such text without a font instead of printing garbage', async () => {
      for (const summary of [vi, ko, ja]) {
        await expect(formatPdf(summary)).rejects.toBeInstanceOf(PdfFontRequiredError);
      }
    });

    it('asks for the face name when given a font collection (.ttc)', async () => {
      await expect(formatPdf(ko, { fontPath: '/fonts/NotoSansCJK-Regular.ttc' })).rejects.toThrow(
        /font collection .*fc-scan/,
      );
    });

    it('fails clearly when the font file does not exist', async () => {
      await expect(formatPdf(vi, { fontPath: '/nonexistent/font.ttf' })).rejects.toThrow(
        /ENOENT|no such file/,
      );
    });

    // System fonts: present on most Linux machines, so the test runs where it can.
    const DEJAVU = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    const WQY = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc';

    it.skipIf(!existsSync(DEJAVU))('embeds the given font for Vietnamese', async () => {
      const pdf = (await formatPdf(vi, { fontPath: DEJAVU })).toString('latin1');
      expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+DejaVuSans/);
      expect(pdf).not.toMatch(/\/BaseFont \/Helvetica/);
    });

    it.skipIf(!existsSync(WQY))(
      'embeds a face from a .ttc collection for Korean / Japanese',
      async () => {
        for (const summary of [ko, ja]) {
          const pdf = (
            await formatPdf(summary, { fontPath: WQY, fontFamily: 'WenQuanYiZenHei' })
          ).toString('latin1');
          expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+WenQuanYi/);
        }
      },
    );
  });
});
