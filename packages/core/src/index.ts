/**
 * @fhirbridge/core
 * FHIR R4 engine: parsing, validation, bundle construction, and streaming pipeline.
 */

// ── Re-export commonly used types from @fhirbridge/types ────────────────────
export type {
  Resource,
  DomainResource,
  Bundle,
  BundleEntry,
  BundleType,
  Patient,
  Encounter,
  Condition,
  Observation,
  MedicationRequest,
  AllergyIntolerance,
  Procedure,
  DiagnosticReport,
  ValidationResult,
  ValidationError,
  ValidationSeverity,
} from '@fhirbridge/types';

// ── Validators ───────────────────────────────────────────────────────────────
export { validateResource, patterns } from './validators/resource-validator.js';
export { validatePatient } from './validators/patient-validator.js';
export { validateCoding, validateCodeableConcept } from './validators/coding-validator.js';
export { validateReference, validateReferenceInBundle } from './validators/reference-validator.js';
// Sprint 3+4 expansion: 7 additional resource validators
export {
  validateMedication,
  validatePractitioner,
  validateDocumentReference,
  validateCarePlan,
  validateCareTeam,
  validateImmunization,
  validateSpecimen,
} from './validators/index.js';

// ── Bundle utilities ─────────────────────────────────────────────────────────
export { BundleBuilder } from './bundle/bundle-builder.js';
export { IPSBundleBuilder, IPS_SECTION_CODES } from './bundle/ips-builder.js';
export {
  serializeToJson,
  serializeToNdjson,
  parseNdjson,
  createReadableStream,
  serializeResourceAsNdjsonLine,
} from './bundle/bundle-serializer.js';

// ── Pipeline ─────────────────────────────────────────────────────────────────
export { transformToFhir } from './pipeline/resource-transformer.js';
export { TransformPipeline, arrayToAsyncIterable } from './pipeline/transform-pipeline.js';
export type { RawRecord, MappingConfig, PipelineConfig } from './pipeline/index.js';

// ── HIS Connectors ───────────────────────────────────────────────────────────
export type {
  HisConnector,
  ConnectionStatus,
  RawRecord as ConnectorRawRecord,
} from './connectors/index.js';
export {
  ConnectorError,
  FhirEndpointConnector,
  CsvConnector,
  ExcelConnector,
} from './connectors/index.js';
export { mapRow, withRetry, isRetryable } from './connectors/index.js';
export type { RetryOptions } from './connectors/index.js';

// ── AI Summary Engine ────────────────────────────────────────────────────────
export type { AiProvider } from './ai/ai-provider-interface.js';
export { ClaudeProvider, CLAUDE_DEFAULT_MODEL } from './ai/claude-provider.js';
export { OpenAiProvider, OPENAI_DEFAULT_MODEL } from './ai/openai-provider.js';
export { ProviderGateway } from './ai/provider-gateway.js';
export { deidentify, reidentifyDates, hashIdentifier, shiftDate } from './ai/deidentifier.js';
export type { DeidentifyResult } from './ai/deidentifier.js';
export { summarizeSections } from './ai/section-summarizer.js';
export { synthesize } from './ai/synthesis-engine.js';
export { getSectionPrompt, getSynthesisPrompt, isSupportedSection } from './ai/prompt-templates.js';
export type { PromptVariables, PromptPair, SectionName } from './ai/prompt-templates.js';
export { formatMarkdown, formatComposition } from './ai/summary-formatter.js';
export type { FhirComposition } from './ai/summary-formatter.js';
export { TokenTracker } from './ai/token-tracker.js';
export type { TokenRecord, AggregatedTokenUsage } from './ai/token-tracker.js';

// ── Security utilities ───────────────────────────────────────────────────────
export { validateBaseUrl, validateBaseUrlWithDns } from './security/index.js';
export type { ValidateBaseUrlResult } from './security/index.js';
export { isValidRrn, containsRrn, maskRrn, RRN_MASK } from './security/index.js';

// ── Coding utilities ─────────────────────────────────────────────────────────
export {
  LOINC_SYSTEM,
  SNOMED_SYSTEM,
  RXNORM_SYSTEM,
  ICD10_CM_SYSTEM,
  CONDITION_CLINICAL_SYSTEM,
  CONDITION_VER_STATUS_SYSTEM,
  ALLERGY_CLINICAL_SYSTEM,
  ALLERGY_VER_STATUS_SYSTEM,
  OBSERVATION_CATEGORY_SYSTEM,
  KNOWN_SYSTEMS,
  lookupCode,
  isKnownCode,
  getCodesForSystem,
} from './coding/index.js';
export type { CodeInfo } from './coding/index.js';
