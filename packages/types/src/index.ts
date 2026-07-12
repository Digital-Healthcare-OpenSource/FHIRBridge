/**
 * @fhirbridge/types
 * Shared FHIR R4 type definitions used across all FHIRBridge packages.
 * Re-exports essential types from @types/fhir with FHIRBridge-specific additions.
 */

// ── FHIR R4 Resource types (structured sub-module) ───────────────────────────
export type {
  Resource,
  DomainResource,
  Reference,
  CodeableConcept,
  Coding,
  HumanName,
  Address,
  ContactPoint,
  Period,
  Identifier,
  Meta,
  Narrative,
  Extension,
  Quantity,
  Dosage,
  ValidationError,
  ValidationResult,
  ValidationSeverity,
  Patient,
  AdministrativeGender,
  PatientLink,
  PatientContact,
  Encounter,
  EncounterStatus,
  EncounterParticipant,
  EncounterDiagnosis,
  Condition,
  ConditionEvidence,
  ConditionStage,
  Observation,
  ObservationStatus,
  ObservationCategory,
  ObservationComponent,
  ObservationReferenceRange,
  MedicationRequest,
  MedicationRequestStatus,
  MedicationRequestIntent,
  AllergyIntolerance,
  AllergyIntoleranceReaction,
  Procedure,
  ProcedureStatus,
  DiagnosticReport,
  DiagnosticReportStatus,
  Bundle,
  BundleEntry,
  BundleType,
  BundleLink,
  // Newly added resource types
  Ratio,
  Attachment,
  Medication,
  MedicationStatus,
  MedicationIngredient,
  MedicationBatch,
  Practitioner,
  PractitionerGender,
  PractitionerQualification,
  DocumentReference,
  DocumentReferenceStatus,
  DocumentReferenceDocStatus,
  DocumentReferenceContent,
  DocumentReferenceContext,
  CarePlan,
  CarePlanStatus,
  CarePlanIntent,
  CarePlanActivity,
  CarePlanActivityStatus,
  CarePlanActivityDetail,
  CareTeam,
  CareTeamStatus,
  CareTeamParticipant,
  Immunization,
  ImmunizationStatus,
  ImmunizationPerformer,
  ImmunizationProtocolApplied,
  Specimen,
  SpecimenStatus,
  SpecimenCollection,
  SpecimenProcessing,
  SpecimenContainer,
} from './fhir/index.js';

// ── FHIR R4 Core Resource Types ────────────────────────────────────────────

/** Base FHIR resource with required resourceType */
export interface FhirResource {
  resourceType: string;
  id?: string;
  meta?: FhirMeta;
  text?: FhirNarrative;
  [key: string]: unknown;
}

/** FHIR Meta element */
export interface FhirMeta {
  versionId?: string;
  lastUpdated?: string;
  source?: string;
  profile?: string[];
  tag?: FhirCoding[];
}

/** FHIR Narrative */
export interface FhirNarrative {
  status: 'generated' | 'extensions' | 'additional' | 'empty';
  div: string;
}

/** FHIR Coding */
export interface FhirCoding {
  system?: string;
  version?: string;
  code?: string;
  display?: string;
  userSelected?: boolean;
}

/** FHIR CodeableConcept */
export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

/** FHIR Reference */
export interface FhirReference {
  reference?: string;
  type?: string;
  display?: string;
}

/** FHIR Bundle entry */
export interface FhirBundleEntry {
  fullUrl?: string;
  resource?: FhirResource;
  request?: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
  };
  response?: {
    status: string;
    location?: string;
  };
}

/** FHIR R4 Bundle */
export interface FhirBundle extends FhirResource {
  resourceType: 'Bundle';
  type: FhirBundleType;
  total?: number;
  timestamp?: string;
  entry?: FhirBundleEntry[];
  link?: Array<{ relation: string; url: string }>;
}

export type FhirBundleType =
  | 'document'
  | 'message'
  | 'transaction'
  | 'transaction-response'
  | 'batch'
  | 'batch-response'
  | 'history'
  | 'searchset'
  | 'collection';

// ── FHIR R4 Patient Resource ────────────────────────────────────────────────

/** Supported FHIR R4 resource types for export */
export type SupportedResourceType =
  | 'Patient'
  | 'Condition'
  | 'MedicationRequest'
  | 'Observation'
  | 'DiagnosticReport'
  | 'Encounter'
  | 'Procedure'
  | 'AllergyIntolerance'
  | 'Immunization'
  | 'CarePlan';

// ── Export Options ──────────────────────────────────────────────────────────

/** Options for exporting patient FHIR data */
export interface ExportOptions {
  /** Patient identifier in the HIS system */
  patientId: string;
  /** Resource types to include in export */
  resourceTypes?: SupportedResourceType[];
  /** ISO 8601 date range start */
  dateFrom?: string;
  /** ISO 8601 date range end */
  dateTo?: string;
  /** Output format */
  format?: ExportFormat;
  /** Include AI-generated summary */
  includeSummary?: boolean;
  /** Target locale for summary */
  locale?: 'en' | 'vi' | 'ja';
}

export type ExportFormat = 'fhir-json' | 'fhir-ndjson' | 'csv' | 'pdf';

// ── Summary Options ─────────────────────────────────────────────────────────

/** Options for AI summary generation */
export interface SummaryOptions {
  /** De-identified FHIR bundle (no real patient data) */
  bundle: FhirBundle;
  /** Target language for summary */
  locale?: 'en' | 'vi' | 'ja';
  /** AI provider to use */
  provider?: 'anthropic' | 'openai';
  /** Detail level */
  level?: 'brief' | 'standard' | 'detailed';
}

/** AI-generated summary result */
export interface SummaryResult {
  text: string;
  locale: string;
  provider: string;
  generatedAt: string;
  /** True = data was de-identified before AI call */
  deidentified: boolean;
}

// ── Audit Types ─────────────────────────────────────────────────────────────

/** Audit log entry (NO PHI — only hashes and metadata) */
export interface AuditLogEntry {
  id?: string;
  timestamp?: string;
  /** HMAC-SHA256 hash of user identifier — never raw ID */
  userIdHash: string;
  action: AuditAction;
  resourceCount?: number;
  status: 'success' | 'error' | 'pending';
  metadata?: Record<string, unknown>;
}

export type AuditAction =
  | 'export_start'
  | 'export_complete'
  | 'export_error'
  | 'summary_generate'
  | 'summary_access_denied'
  | 'auth_login'
  | 'auth_logout'
  | 'consent_grant'
  | 'consent_revoke';

// ── API Types ───────────────────────────────────────────────────────────────

/** Standard API error response */
export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  requestId?: string;
}

/** Health check response */
export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  timestamp: string;
  checks: Record<string, 'ok' | 'error'>;
}

// ── Connector Configuration Types ───────────────────────────────────────────
export type {
  ConnectorConfig,
  ConnectorType,
  FhirEndpointConfig,
  FileImportConfig,
  ColumnMapping,
  CodeMapping,
  MappedRecord,
  TransformType,
} from './connectors/index.js';

/**
 * Text encodings supported for CSV/Excel file import decoding.
 * Shared so connector config and file readers agree on the allowed set —
 * includes Japanese encodings (Shift-JIS, EUC-JP) common in JP HIS exports.
 */
export type SupportedEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'shift-jis' | 'euc-jp';

// ── AI Summary Engine Types ──────────────────────────────────────────────────
export type {
  AiProviderName,
  SummaryOutputFormat,
  SummaryDetailLevel,
  SummaryLanguage,
  AiProviderConfig,
  SummaryConfig,
  GenerateOptions,
  TokenUsage,
  AiResponse,
  SectionSummary,
  SummaryMetadata,
  PatientSummary,
  DeidentifiedBundle,
  DateShiftMap,
} from './ai/index.js';

// ── HIS Connector Types ─────────────────────────────────────────────────────

/** HIS connection configuration */
export interface HisConfig {
  baseUrl: string;
  clientId?: string;
  tokenUrl?: string;
  timeout?: number;
}

/** HIS authentication token */
export interface HisAuthToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: number;
}
