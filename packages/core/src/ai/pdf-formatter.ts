/**
 * PDF formatter — converts PatientSummary into a professional A4 PDF report.
 * Uses pdfkit (no Puppeteer dependency). Returns a Buffer containing the PDF bytes.
 *
 * pdfkit's built-in fonts (Helvetica) use the single-byte WinAnsi encoding: they
 * cannot draw most Vietnamese letters (ă, ơ, ế…) or any Korean / Japanese text.
 * Pass `fontPath` — a TTF / OTF / TTC with the needed glyphs — for those languages;
 * without it, such text is rejected instead of being silently printed as garbage.
 */

import type { PatientSummary } from '@fhirbridge/types';
import PDFDocument from 'pdfkit';

const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4 points
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/** Colour palette */
const COLOR_PRIMARY = '#1a3a5c';
const COLOR_ACCENT = '#2563eb';
const COLOR_MUTED = '#6b7280';
const COLOR_BORDER = '#e5e7eb';

/** Registered font names used by every render step. */
const FONT_REGULAR = 'Body';
const FONT_BOLD = 'Body-Bold';

/** Characters the built-in WinAnsi fonts can draw (Latin-1 + the cp1252 extras). */
const WIN_ANSI_TEXT = /^[\t\n\r\u0020-\u007e\u00a0-\u00ff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/u;

export interface PdfFormatOptions {
  /** Font file (TTF / OTF / TTC) covering the summary language, e.g. a Noto Sans CJK file. */
  fontPath?: string;
  /** Face to use inside a font collection (.ttc), by PostScript name. */
  fontFamily?: string;
}

/** Thrown when the summary needs a Unicode font and none was given. */
export class PdfFontRequiredError extends Error {
  constructor() {
    super(
      'This summary contains characters the built-in PDF font cannot draw (e.g. Vietnamese, ' +
        'Korean or Japanese). Provide a Unicode font file (fontPath; CLI: --pdf-font <file>).',
    );
    this.name = 'PdfFontRequiredError';
  }
}

/** True when every text the report prints fits the built-in font. */
export function fitsBuiltInPdfFont(summary: PatientSummary): boolean {
  const { metadata } = summary;
  const texts = [
    summary.synthesis,
    metadata.provider,
    metadata.model,
    metadata.language,
    metadata.generatedAt,
    ...summary.sections.flatMap((s) => [s.section, s.content]),
  ];
  return texts.every((t) => WIN_ANSI_TEXT.test(t ?? ''));
}

/**
 * Generate a PDF report for the given PatientSummary.
 * @returns Promise resolving to a Buffer containing the PDF bytes.
 * @throws PdfFontRequiredError when the text needs `options.fontPath`.
 */
export function formatPdf(
  summary: PatientSummary,
  options: PdfFormatOptions = {},
): Promise<Buffer> {
  if (!options.fontPath && !fitsBuiltInPdfFont(summary)) {
    return Promise.reject(new PdfFontRequiredError());
  }
  if (options.fontPath && /\.(ttc|otc)$/i.test(options.fontPath) && !options.fontFamily) {
    return Promise.reject(
      new Error(
        `${options.fontPath} is a font collection — also give the face's PostScript name ` +
          `(fontFamily; CLI: --pdf-font-family). List them with: fc-scan --format "%{postscriptname}\\n" <file>`,
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      if (options.fontPath) {
        // One face for both weights: CJK fonts rarely ship a matching bold.
        doc.registerFont(FONT_REGULAR, options.fontPath, options.fontFamily);
        doc.registerFont(FONT_BOLD, options.fontPath, options.fontFamily);
      } else {
        doc.registerFont(FONT_REGULAR, 'Helvetica');
        doc.registerFont(FONT_BOLD, 'Helvetica-Bold');
      }

      renderHeader(doc, summary);
      renderMetadata(doc, summary);
      renderDisclaimer(doc);
      renderNarrative(doc, summary);
      renderSections(doc, summary);
      renderFooter(doc);
    } catch (err) {
      reject(err);
      return;
    }

    doc.end();
  });
}

/** Render the top header bar with FHIRBridge branding */
function renderHeader(doc: PDFKit.PDFDocument, _summary: PatientSummary): void {
  doc.rect(MARGIN - 10, MARGIN - 10, CONTENT_WIDTH + 20, 50).fill(COLOR_PRIMARY);

  doc
    .fillColor('#ffffff')
    .fontSize(20)
    .font(FONT_BOLD)
    .text('FHIRBridge', MARGIN, MARGIN + 8, { continued: true })
    .font(FONT_REGULAR)
    .fontSize(10)
    .fillColor('#93c5fd')
    .text('  — AI Patient Summary', { align: 'left' });

  doc.moveDown(2);
  doc
    .fillColor(COLOR_PRIMARY)
    .fontSize(16)
    .font(FONT_BOLD)
    .text('Patient Summary Report', MARGIN, doc.y);

  doc
    .moveTo(MARGIN, doc.y + 4)
    .lineTo(MARGIN + CONTENT_WIDTH, doc.y + 4)
    .strokeColor(COLOR_ACCENT)
    .lineWidth(2)
    .stroke();

  doc.moveDown(1);
}

/** Render metadata block (generated at, provider, model, etc.) */
function renderMetadata(doc: PDFKit.PDFDocument, summary: PatientSummary): void {
  const { metadata } = summary;
  const metaItems = [
    ['Generated', metadata.generatedAt],
    ['Provider', `${metadata.provider} (${metadata.model})`],
    ['Language', metadata.language],
    ['Tokens used', String(metadata.totalTokens)],
    ['De-identified', metadata.deidentified ? 'Yes' : 'No'],
  ];

  doc.fontSize(9).font(FONT_REGULAR).fillColor(COLOR_MUTED);

  for (const [label, value] of metaItems) {
    doc
      .text(`${label}: `, { continued: true })
      .font(FONT_BOLD)
      .text(value ?? '')
      .font(FONT_REGULAR);
  }

  doc.moveDown(0.5);
}

/** Render the AI disclaimer box */
function renderDisclaimer(doc: PDFKit.PDFDocument): void {
  const y = doc.y;
  const boxHeight = 30;
  doc.rect(MARGIN, y, CONTENT_WIDTH, boxHeight).fillAndStroke('#fff7ed', '#f97316');

  doc
    .fillColor('#c2410c')
    .fontSize(8)
    .font(FONT_BOLD)
    .text(
      'WARNING: This is an AI-generated summary from de-identified data. Always verify against source medical records before clinical use.',
      MARGIN + 8,
      y + 8,
      { width: CONTENT_WIDTH - 16 },
    );

  doc.moveDown(2);
}

/** Render the clinical narrative section */
function renderNarrative(doc: PDFKit.PDFDocument, summary: PatientSummary): void {
  renderSectionHeading(doc, 'Clinical Narrative');
  doc
    .fontSize(10)
    .font(FONT_REGULAR)
    .fillColor('#111827')
    .text(summary.synthesis, MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'justify' });
  doc.moveDown(1);
}

/** Render all summary sections */
function renderSections(doc: PDFKit.PDFDocument, summary: PatientSummary): void {
  renderSectionHeading(doc, 'Section Details');

  for (const section of summary.sections) {
    // Add new page if near bottom
    if (doc.y > 700) doc.addPage();

    doc.fontSize(11).font(FONT_BOLD).fillColor(COLOR_ACCENT).text(section.section, MARGIN, doc.y);

    if (section.resourceCount > 0) {
      doc
        .fontSize(8)
        .font(FONT_REGULAR)
        .fillColor(COLOR_MUTED)
        .text(`${section.resourceCount} resource(s) summarized`);
    }

    doc
      .moveTo(MARGIN, doc.y + 2)
      .lineTo(MARGIN + CONTENT_WIDTH, doc.y + 2)
      .strokeColor(COLOR_BORDER)
      .lineWidth(0.5)
      .stroke();

    doc
      .moveDown(0.3)
      .fontSize(10)
      .font(FONT_REGULAR)
      .fillColor('#111827')
      .text(section.content, MARGIN, doc.y, { width: CONTENT_WIDTH });

    doc.moveDown(1);
  }
}

/** Render a section heading with a coloured background strip */
function renderSectionHeading(doc: PDFKit.PDFDocument, title: string): void {
  const y = doc.y;
  doc.rect(MARGIN, y, CONTENT_WIDTH, 18).fill('#eff6ff');
  doc
    .fillColor(COLOR_PRIMARY)
    .fontSize(12)
    .font(FONT_BOLD)
    .text(title, MARGIN + 6, y + 3);
  doc.moveDown(0.8);
}

/** Stamp footer on every page */
function renderFooter(doc: PDFKit.PDFDocument): void {
  const pageCount = (
    doc as unknown as { bufferedPageRange(): { count: number } }
  ).bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    const footerY = doc.page.height - MARGIN + 10;
    doc
      .moveTo(MARGIN, footerY - 6)
      .lineTo(PAGE_WIDTH - MARGIN, footerY - 6)
      .strokeColor(COLOR_BORDER)
      .lineWidth(0.5)
      .stroke();

    doc
      .fontSize(7)
      .font(FONT_REGULAR)
      .fillColor(COLOR_MUTED)
      .text('AI-generated summary — verify with healthcare provider', MARGIN, footerY, {
        width: CONTENT_WIDTH * 0.7,
        align: 'left',
      });

    doc.text(`Page ${i + 1} of ${pageCount}`, MARGIN, footerY, {
      width: CONTENT_WIDTH,
      align: 'right',
    });
  }
}
