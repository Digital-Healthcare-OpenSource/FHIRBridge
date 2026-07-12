/**
 * Structured prompt templates for the AI summary engine.
 * Each section type has a system prompt and a user prompt template.
 * Supports English (en), Vietnamese (vi), and Japanese (ja).
 */

import type { SummaryDetailLevel, SummaryLanguage } from '@fhirbridge/types';

/** Variables available in prompt templates */
export interface PromptVariables {
  language: SummaryLanguage;
  detailLevel: SummaryDetailLevel;
  resourceData: string;
  /**
   * True khi dates trong output vẫn còn bị shift (multi-patient bundle không
   * thể re-identify an toàn). Khi bật, prompt nêu rõ dates đã shift để lâm
   * sàng không hiểu nhầm là ngày thật.
   */
  datesShifted?: boolean;
}

/** A complete prompt with system and user parts */
export interface PromptPair {
  systemPrompt: string;
  userPrompt: string;
}

/** Supported section names */
export type SectionName =
  | 'Conditions'
  | 'Medications'
  | 'Allergies'
  | 'Vitals'
  | 'Observations'
  | 'Procedures'
  | 'Encounters'
  | 'DiagnosticReports'
  | 'Immunizations'
  | 'Demographics';

/** Language display names for prompt instructions */
const LANGUAGE_NAMES: Record<SummaryLanguage, string> = {
  en: 'English',
  vi: 'Vietnamese (Tiếng Việt)',
  ja: 'Japanese (日本語)',
};

/**
 * Language-specific instructions added to system prompts.
 * Mỗi ngôn ngữ đều yêu cầu giữ nguyên CHÍNH XÁC tên thuốc, mã lâm sàng và
 * giá trị/đơn vị liều — chỉ dịch phần diễn giải xung quanh (an toàn lâm sàng).
 */
const LANGUAGE_INSTRUCTIONS: Record<SummaryLanguage, string> = {
  en: 'Respond in clear, professional English. Keep medication names, clinical codes, and dosage values/units EXACTLY as they appear in the data; translate only the surrounding narrative.',
  vi: 'Phản hồi bằng tiếng Việt rõ ràng, chuyên nghiệp. Sử dụng thuật ngữ y tế chuẩn. Giữ nguyên CHÍNH XÁC tên thuốc, mã lâm sàng và giá trị/đơn vị liều lượng như trong dữ liệu; chỉ dịch phần diễn giải xung quanh.',
  ja: '明確かつ専門的な日本語で回答してください。標準的な医療用語を使用してください。薬剤名、臨床コード、用量の数値と単位はデータのとおり正確に保持し、周囲の説明文のみを翻訳してください。',
};

/**
 * Note appended to prompts when dates in the data remain shifted in the final
 * output (multi-patient bundles cannot be safely date-re-identified).
 */
const DATES_SHIFTED_NOTE =
  'NOTE: All dates in this data have been shifted by a fixed number of days for privacy. State clearly that dates are shifted for privacy and must not be read as real calendar dates.';

/** Detail level instructions */
const DETAIL_INSTRUCTIONS: Record<SummaryDetailLevel, string> = {
  brief: 'Provide a brief 2-3 sentence summary covering only the most critical points.',
  standard: 'Provide a standard summary with key findings, organized by clinical significance.',
  detailed:
    'Provide a detailed clinical summary with all relevant findings, dates, values, and clinical context.',
};

/**
 * Build a system prompt for a section type.
 */
function buildSystemPrompt(section: string, variables: PromptVariables): string {
  const lang = LANGUAGE_NAMES[variables.language];
  const langInstr = LANGUAGE_INSTRUCTIONS[variables.language];
  const detailInstr = DETAIL_INSTRUCTIONS[variables.detailLevel];

  const lines = [
    `You are a clinical documentation assistant summarizing de-identified ${section} data.`,
    `Language: ${lang}. ${langInstr}`,
    `Detail level: ${variables.detailLevel}. ${detailInstr}`,
    'IMPORTANT: All patient identifiers have been de-identified. Do not attempt to identify patients.',
    'Focus on clinically significant findings. Do not hallucinate or invent information not in the data.',
    'If data is empty or insufficient, state that briefly.',
  ];

  // Multi-patient bundle: dates stay shifted in the output — warn explicitly.
  if (variables.datesShifted) {
    lines.push(DATES_SHIFTED_NOTE);
  }

  return lines.join('\n');
}

/**
 * Per-section user prompt templates.
 * Each returns a formatted prompt string with the resource data inserted.
 */
const SECTION_PROMPTS: Record<SectionName, (vars: PromptVariables) => PromptPair> = {
  Conditions: (vars) => ({
    systemPrompt: buildSystemPrompt('Conditions', vars),
    userPrompt: `Summarize the following de-identified medical conditions. Focus on: active conditions, severity, onset dates, clinical significance, and any chronic or significant diagnoses.

Conditions data:
${vars.resourceData}`,
  }),

  Medications: (vars) => ({
    systemPrompt: buildSystemPrompt('Medications', vars),
    userPrompt: `Summarize the following de-identified medication orders. Include: medication names, dosages, frequencies, indications (if available), and active vs discontinued status.

Medications data:
${vars.resourceData}`,
  }),

  Allergies: (vars) => ({
    systemPrompt: buildSystemPrompt('Allergies', vars),
    userPrompt: `Summarize the following de-identified allergy records. Highlight: allergens, reaction types, severity, and clinical status. Note any high-severity or life-threatening allergies prominently.

Allergies data:
${vars.resourceData}`,
  }),

  Vitals: (vars) => ({
    systemPrompt: buildSystemPrompt('Vital Signs', vars),
    userPrompt: `Summarize the following de-identified vital signs observations. Include: trends, abnormal values, most recent readings, and clinically significant patterns.

Vital signs data:
${vars.resourceData}`,
  }),

  Observations: (vars) => ({
    systemPrompt: buildSystemPrompt('Clinical Observations', vars),
    userPrompt: `Summarize the following de-identified clinical observations. These may include laboratory results, social-history findings (e.g. smoking status), imaging observations, and other non-vital categories. Group by observation category where helpful, and highlight: abnormal values, significant trends, and clinically important results. Include reference ranges where available.

Observations data:
${vars.resourceData}`,
  }),

  Procedures: (vars) => ({
    systemPrompt: buildSystemPrompt('Procedures', vars),
    userPrompt: `Summarize the following de-identified procedures. Include: procedure types, dates (shifted for privacy), outcomes, and any relevant clinical notes.

Procedures data:
${vars.resourceData}`,
  }),

  Encounters: (vars) => ({
    systemPrompt: buildSystemPrompt('Encounters', vars),
    userPrompt: `Summarize the following de-identified clinical encounters. Include: encounter types, reasons for visit, dates (shifted for privacy), and care settings.

Encounters data:
${vars.resourceData}`,
  }),

  DiagnosticReports: (vars) => ({
    systemPrompt: buildSystemPrompt('Diagnostic Reports', vars),
    userPrompt: `Summarize the following de-identified diagnostic reports. Include: report types, key findings, conclusions, and clinical significance.

Diagnostic reports data:
${vars.resourceData}`,
  }),

  Immunizations: (vars) => ({
    systemPrompt: buildSystemPrompt('Immunizations', vars),
    userPrompt: `Summarize the following de-identified immunization records. Include: vaccine names/codes, status (completed vs not-done), and dates (shifted for privacy). Note any incomplete or refused immunizations.

Immunizations data:
${vars.resourceData}`,
  }),

  Demographics: (vars) => ({
    systemPrompt: buildSystemPrompt('Patient Demographics', vars),
    userPrompt: `Provide a brief de-identified demographic overview. Include only: age range (not exact birthdate), biological sex, and general geographic region. Do NOT include names, IDs, or exact dates.

Demographics data:
${vars.resourceData}`,
  }),
};

/**
 * Get the prompt pair for a specific section type.
 */
export function getSectionPrompt(section: SectionName, variables: PromptVariables): PromptPair {
  const builder = SECTION_PROMPTS[section];
  return builder(variables);
}

/**
 * Get the synthesis prompt that combines all section summaries into a narrative.
 */
export function getSynthesisPrompt(
  sectionSummaries: Array<{ section: string; content: string }>,
  variables: Omit<PromptVariables, 'resourceData'>,
): PromptPair {
  const lang = LANGUAGE_NAMES[variables.language];
  const langInstr = LANGUAGE_INSTRUCTIONS[variables.language];
  const detailInstr = DETAIL_INSTRUCTIONS[variables.detailLevel];

  const summaryText = sectionSummaries.map((s) => `## ${s.section}\n${s.content}`).join('\n\n');

  const systemLines = [
    'You are a clinical documentation assistant creating a comprehensive patient summary narrative.',
    `Language: ${lang}. ${langInstr}`,
    `Detail level: ${variables.detailLevel}. ${detailInstr}`,
    'Synthesize the section summaries into a coherent, readable patient narrative.',
    'Structure: start with key concerns, then medications, allergy warnings, recent visits, and overall clinical picture.',
    'Add a disclaimer: "This is an AI-generated summary from de-identified data. Verify against source records."',
    'IMPORTANT: All data is de-identified. Do not attempt to identify patients.',
  ];

  if (variables.datesShifted) {
    systemLines.push(DATES_SHIFTED_NOTE);
  }

  const systemPrompt = systemLines.join('\n');

  const userPrompt = `Create a comprehensive patient summary narrative from the following section summaries:

${summaryText}

Produce a well-structured, clinically useful summary that a healthcare provider can quickly review.`;

  return { systemPrompt, userPrompt };
}

/**
 * Check whether a section has a prompt template defined.
 */
export function isSupportedSection(section: string): section is SectionName {
  return section in SECTION_PROMPTS;
}
