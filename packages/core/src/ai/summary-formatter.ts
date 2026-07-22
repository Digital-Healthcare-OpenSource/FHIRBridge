/**
 * Summary formatter — converts PatientSummary into output formats.
 * Supports: Markdown, FHIR Composition.
 * PDF output via Puppeteer is deferred — see TODO below.
 */

import type { PatientSummary, SectionSummary, SummaryLanguage } from '@fhirbridge/types';
export { formatPdf } from './pdf-formatter.js';

/** FHIR R4 Composition resource (minimal shape for type safety) */
export interface FhirComposition {
  resourceType: 'Composition';
  id?: string;
  status: 'preliminary' | 'final' | 'amended' | 'entered-in-error';
  type: {
    coding: Array<{ system: string; code: string; display: string }>;
    text: string;
  };
  subject?: { reference: string };
  date: string;
  author: Array<{ display: string }>;
  title: string;
  section: Array<{
    title: string;
    text: { status: 'generated'; div: string };
  }>;
}

/** Localized headings/labels — a small string table keyed by language. */
interface Headings {
  title: string;
  clinicalNarrative: string;
  sectionDetails: string;
  disclaimerHeading: string;
  endOfSummary: string;
  yes: string;
  no: string;
  resourcesSummarized: (n: number) => string;
  truncatedWarning: string;
  excludedNote: (types: string[]) => string;
}

const HEADINGS: Record<SummaryLanguage, Headings> = {
  en: {
    title: 'Patient Summary Report',
    clinicalNarrative: 'Clinical Narrative',
    sectionDetails: 'Section Details',
    disclaimerHeading: 'Disclaimer',
    endOfSummary: 'End of AI-generated summary',
    yes: 'Yes',
    no: 'No',
    resourcesSummarized: (n) => `${n} resource(s) summarized`,
    truncatedWarning:
      '⚠️ This section was truncated (model token limit reached) and may be incomplete.',
    excludedNote: (types) =>
      `⚠️ ${types.length} resource type(s) were not summarized (no section mapping): ${types.join(', ')}.`,
  },
  vi: {
    title: 'Báo cáo Tóm tắt Bệnh nhân',
    clinicalNarrative: 'Diễn giải Lâm sàng',
    sectionDetails: 'Chi tiết từng Mục',
    disclaimerHeading: 'Tuyên bố miễn trừ',
    endOfSummary: 'Kết thúc bản tóm tắt do AI tạo',
    yes: 'Có',
    no: 'Không',
    resourcesSummarized: (n) => `Đã tóm tắt ${n} tài nguyên`,
    truncatedWarning:
      '⚠️ Mục này bị cắt ngắn (đạt giới hạn token của mô hình) và có thể chưa đầy đủ.',
    excludedNote: (types) =>
      `⚠️ ${types.length} loại tài nguyên không được tóm tắt (không có ánh xạ mục): ${types.join(', ')}.`,
  },
  ja: {
    title: '患者サマリーレポート',
    clinicalNarrative: '臨床ナラティブ',
    sectionDetails: 'セクション詳細',
    disclaimerHeading: '免責事項',
    endOfSummary: 'AI生成サマリーの終わり',
    yes: 'はい',
    no: 'いいえ',
    resourcesSummarized: (n) => `${n}件のリソースを要約`,
    truncatedWarning:
      '⚠️ このセクションは打ち切られ（モデルのトークン上限に到達）、不完全な可能性があります。',
    excludedNote: (types) =>
      `⚠️ ${types.length}件のリソースタイプは要約されませんでした（セクション未対応）: ${types.join(', ')}。`,
  },
  ko: {
    title: '환자 요약 보고서',
    clinicalNarrative: '임상 기술',
    sectionDetails: '섹션 상세',
    disclaimerHeading: '면책 조항',
    endOfSummary: 'AI 생성 요약 끝',
    yes: '예',
    no: '아니오',
    resourcesSummarized: (n) => `리소스 ${n}건 요약됨`,
    truncatedWarning: '⚠️ 이 섹션은 모델의 토큰 한도에 도달하여 잘렸으며 불완전할 수 있습니다.',
    excludedNote: (types) =>
      `⚠️ 리소스 유형 ${types.length}건은 요약되지 않았습니다(섹션 매핑 없음): ${types.join(', ')}.`,
  },
};

/** Localized clinician-review disclaimers. */
const DISCLAIMERS: Record<SummaryLanguage, string> = {
  en: '⚠️ Disclaimer: This is an AI-generated summary derived from de-identified data. It may contain errors or omissions and must be reviewed by a qualified clinician and verified against the source medical records before any clinical use.',
  vi: '⚠️ Tuyên bố miễn trừ: Đây là bản tóm tắt do AI tạo ra từ dữ liệu đã ẩn danh. Bản tóm tắt có thể chứa sai sót hoặc thiếu sót và phải được bác sĩ có chuyên môn xem xét, đối chiếu với hồ sơ bệnh án gốc trước khi sử dụng trong lâm sàng.',
  ja: '⚠️ 免責事項: これは匿名化されたデータからAIが生成した要約です。誤りや欠落が含まれる可能性があり、臨床使用の前に有資格の臨床医が確認し、元の診療記録と照合する必要があります。',
  ko: '⚠️ 면책 조항: 본 문서는 비식별화된 데이터를 바탕으로 AI가 생성한 요약입니다. 오류나 누락이 포함될 수 있으므로, 임상적으로 사용하기 전에 반드시 자격을 갖춘 의료인이 검토하고 원본 진료 기록과 대조하여 확인해야 합니다.',
};

/**
 * Build the localized clinician-review disclaimer.
 * @param language - Target language (falls back to English for unknown values).
 * @param extraNote - Optional extra sentence appended (e.g. a date-shift notice).
 */
export function buildDisclaimer(language: SummaryLanguage, extraNote?: string): string {
  const base = DISCLAIMERS[language] ?? DISCLAIMERS.en;
  return extraNote ? `${base} ${extraNote}` : base;
}

/** Resolve headings for a language, falling back to English. */
function headingsFor(language: SummaryLanguage): Headings {
  return HEADINGS[language] ?? HEADINGS.en;
}

/** Collect the distinct excluded resource types recorded across sections. */
function collectExcludedResourceTypes(sections: SectionSummary[]): string[] {
  const set = new Set<string>();
  for (const s of sections) {
    for (const t of s.excludedResourceTypes ?? []) set.add(t);
  }
  return [...set].sort();
}

/**
 * Format a PatientSummary as Markdown.
 * Produces a structured document with headers per section and a synthesis narrative.
 */
export function formatMarkdown(summary: PatientSummary): string {
  const { sections, synthesis, metadata } = summary;
  const h = headingsFor(metadata.language);
  const disclaimer = metadata.disclaimer ?? buildDisclaimer(metadata.language);

  const lines: string[] = [
    `# ${h.title}`,
    '',
    `> **Generated:** ${metadata.generatedAt}  `,
    `> **Provider:** ${metadata.provider} (${metadata.model})  `,
    `> **Language:** ${metadata.language}  `,
    `> **Tokens used:** ${metadata.totalTokens}  `,
    `> **De-identified:** ${metadata.deidentified ? h.yes : h.no}`,
    '',
    '---',
    '',
    `> ${disclaimer}`,
    '',
    '---',
    '',
    `## ${h.clinicalNarrative}`,
    '',
    synthesis,
    '',
    '---',
    '',
    `## ${h.sectionDetails}`,
    '',
  ];

  for (const section of sections) {
    lines.push(`### ${section.section}`);
    lines.push('');
    if (section.resourceCount > 0) {
      lines.push(`_${h.resourcesSummarized(section.resourceCount)}_`);
      lines.push('');
    }
    if (section.truncated) {
      lines.push(h.truncatedWarning);
      lines.push('');
    }
    lines.push(section.content);
    lines.push('');
  }

  const excluded = collectExcludedResourceTypes(sections);
  if (excluded.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(h.excludedNote(excluded));
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`_${h.endOfSummary}_`);

  return lines.join('\n');
}

/**
 * Format a PatientSummary as a FHIR R4 Composition resource.
 * Each section becomes a Composition.section entry, plus a trailing localized
 * clinician-review disclaimer section.
 *
 * @param summary - The patient summary to format
 * @param patientRef - FHIR reference to the patient (e.g. 'Patient/[PATIENT]')
 */
export function formatComposition(summary: PatientSummary, patientRef: string): FhirComposition {
  const { sections, synthesis, metadata } = summary;
  const h = headingsFor(metadata.language);
  const disclaimer = metadata.disclaimer ?? buildDisclaimer(metadata.language);
  const excluded = collectExcludedResourceTypes(sections);

  const disclaimerText =
    excluded.length > 0 ? `${disclaimer} ${h.excludedNote(excluded)}` : disclaimer;

  const compositionSections: FhirComposition['section'] = [
    {
      title: h.clinicalNarrative,
      text: {
        status: 'generated',
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeHtml(synthesis)}</p></div>`,
      },
    },
    ...sections.map((s) => {
      const body = s.truncated ? `${h.truncatedWarning} ${s.content}` : s.content;
      return {
        title: s.section,
        text: {
          status: 'generated' as const,
          div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeHtml(body)}</p></div>`,
        },
      };
    }),
    {
      title: h.disclaimerHeading,
      text: {
        status: 'generated' as const,
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeHtml(disclaimerText)}</p></div>`,
      },
    },
  ];

  return {
    resourceType: 'Composition',
    status: 'preliminary',
    type: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '34133-9',
          display: 'Summarization of episode note',
        },
      ],
      text: 'Patient Summary',
    },
    subject: patientRef ? { reference: patientRef } : undefined,
    date: metadata.generatedAt,
    author: [
      {
        display: `AI Summary Engine (${metadata.provider}/${metadata.model})`,
      },
    ],
    title: 'AI-Generated Patient Summary',
    section: compositionSections,
  };
}

/**
 * Escape HTML special characters for safe embedding in FHIR Narrative div.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
