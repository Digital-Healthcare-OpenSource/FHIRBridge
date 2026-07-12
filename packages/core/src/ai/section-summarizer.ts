/**
 * Section summarizer — groups FHIR resources by type and generates per-section summaries.
 * Operates only on de-identified bundles. Never receives PHI.
 */

import type { DeidentifiedBundle, SectionSummary, SummaryConfig } from '@fhirbridge/types';
import type { AiProvider } from './ai-provider-interface.js';
import type { TokenTracker } from './token-tracker.js';
import type { SectionName } from './prompt-templates.js';
import { getSectionPrompt } from './prompt-templates.js';

/** Options controlling section summarization. */
export interface SummarizeSectionsOptions {
  /**
   * True khi bundle có nhiều Patient — dates giữ nguyên trạng thái shifted trong
   * output, nên prompt phải nêu rõ điều đó cho lâm sàng.
   */
  datesShifted?: boolean;
}

/** FHIR resourceType → section name mapping */
const RESOURCE_TYPE_TO_SECTION: Record<string, SectionName> = {
  Condition: 'Conditions',
  MedicationRequest: 'Medications',
  MedicationStatement: 'Medications',
  MedicationAdministration: 'Medications',
  MedicationDispense: 'Medications',
  AllergyIntolerance: 'Allergies',
  Observation: 'Observations',
  Procedure: 'Procedures',
  Encounter: 'Encounters',
  DiagnosticReport: 'DiagnosticReports',
  Immunization: 'Immunizations',
  Patient: 'Demographics',
};

/** Observation category codes for vital signs */
const VITAL_SIGNS_CATEGORY_CODES = new Set(['vital-signs', 'VSCat']);

/** Determine whether an Observation is a vital sign or lab result */
function isVitalSign(resource: Record<string, unknown>): boolean {
  const category = resource['category'];
  if (!Array.isArray(category)) return false;
  return category.some((cat: unknown) => {
    if (typeof cat !== 'object' || cat === null) return false;
    const coding = (cat as Record<string, unknown>)['coding'];
    if (!Array.isArray(coding)) return false;
    return coding.some((c: unknown) => {
      if (typeof c !== 'object' || c === null) return false;
      const code = (c as Record<string, unknown>)['code'];
      return typeof code === 'string' && VITAL_SIGNS_CATEGORY_CODES.has(code);
    });
  });
}

/** Result of grouping: section buckets plus any resource types we could not map. */
interface GroupedResources {
  groups: Map<SectionName, Record<string, unknown>[]>;
  /** Distinct resourceTypes present in the bundle but not mapped to any section. */
  excludedResourceTypes: string[];
}

/**
 * Group bundle entries by section name.
 * Returns section buckets plus the distinct set of unmapped resource types so
 * callers can surface them — an unmapped type must never silently vanish behind
 * a "No data available" placeholder.
 */
function groupResourcesBySection(bundle: DeidentifiedBundle): GroupedResources {
  const groups = new Map<SectionName, Record<string, unknown>[]>();
  const excluded = new Set<string>();

  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource as Record<string, unknown> | undefined;
    if (!resource) continue;

    const resourceType = resource['resourceType'] as string | undefined;
    if (!resourceType) continue;

    let section = RESOURCE_TYPE_TO_SECTION[resourceType];
    if (!section) {
      excluded.add(resourceType);
      continue;
    }

    // Split Observations into Vitals and Labs
    if (section === 'Observations' && isVitalSign(resource)) {
      section = 'Vitals';
    }

    const existing = groups.get(section) ?? [];
    existing.push(resource);
    groups.set(section, existing);
  }

  return { groups, excludedResourceTypes: [...excluded].sort() };
}

/**
 * Summarize a single section using the AI provider.
 */
async function summarizeSection(
  section: SectionName,
  resources: Record<string, unknown>[],
  provider: AiProvider,
  config: SummaryConfig,
  tracker: TokenTracker,
  datesShifted: boolean,
): Promise<SectionSummary> {
  if (resources.length === 0) {
    return {
      section,
      content: 'No data available for this section.',
      tokenCount: 0,
      resourceCount: 0,
    };
  }

  const resourceData = JSON.stringify(resources, null, 2);
  const { systemPrompt, userPrompt } = getSectionPrompt(section, {
    language: config.language,
    detailLevel: config.detailLevel,
    resourceData,
    datesShifted,
  });

  const response = await provider.generate(userPrompt, {
    maxTokens: config.providerConfig.maxTokens,
    temperature: config.providerConfig.temperature,
    systemPrompt,
    timeoutMs: config.providerConfig.timeoutMs,
  });

  tracker.track(
    config.providerConfig.provider,
    provider.model,
    section,
    response.tokenUsage.inputTokens,
    response.tokenUsage.outputTokens,
  );

  // finishReason 'max_tokens' means the model ran out of budget mid-answer —
  // the section is incomplete and MUST be flagged so downstream output can warn.
  const truncated = response.finishReason === 'max_tokens';

  return {
    section,
    content: response.content,
    tokenCount: response.tokenUsage.totalTokens,
    resourceCount: resources.length,
    ...(truncated ? { truncated: true } : {}),
  };
}

/**
 * Generate summaries for all resource sections in the de-identified bundle.
 * Processes sections sequentially to respect rate limits.
 * Empty sections produce a "No data available" placeholder.
 */
export async function summarizeSections(
  bundle: DeidentifiedBundle,
  provider: AiProvider,
  config: SummaryConfig,
  tracker: TokenTracker,
  options: SummarizeSectionsOptions = {},
): Promise<SectionSummary[]> {
  const { groups, excludedResourceTypes } = groupResourcesBySection(bundle);
  const datesShifted = options.datesShifted ?? false;

  // Process all sections that have data, plus standard empty sections
  const allSections: SectionName[] = [
    'Demographics',
    'Conditions',
    'Medications',
    'Allergies',
    'Vitals',
    'Observations',
    'Procedures',
    'Encounters',
    'DiagnosticReports',
    'Immunizations',
  ];

  const results: SectionSummary[] = [];

  for (const section of allSections) {
    const resources = groups.get(section) ?? [];
    const summary = await summarizeSection(
      section,
      resources,
      provider,
      config,
      tracker,
      datesShifted,
    );
    results.push(summary);
  }

  // Surface unmapped resource types on the first section so callers/formatters
  // can warn that some data was not summarized (never silently dropped).
  if (excludedResourceTypes.length > 0 && results.length > 0) {
    results[0] = { ...results[0]!, excludedResourceTypes };
  }

  return results;
}
