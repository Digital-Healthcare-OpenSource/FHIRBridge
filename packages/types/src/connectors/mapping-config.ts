/**
 * Column mapping configuration types.
 * Defines how CSV/Excel columns map to FHIR resource fields.
 */

/** Supported transform operations applied to a column value before FHIR mapping */
export type TransformType = 'date' | 'code' | 'string' | 'number';

/**
 * Maps a single source column to a FHIR resource field.
 * Supports optional transforms and code system resolution.
 */
export interface ColumnMapping {
  /** Source column header name */
  sourceColumn: string;
  /** Dot-notation FHIR path (e.g., 'name[0].family', 'birthDate') */
  fhirPath: string;
  /** Target FHIR resource type this mapping belongs to (e.g., 'Patient') */
  resourceType: string;
  /** URI of the code system for coded fields (e.g., 'http://loinc.org') */
  codeSystem?: string;
  /**
   * Transform to apply to the raw value before mapping:
   * - date: parse and normalize to ISO 8601
   * - code: lookup in valueMappings for standardized code
   * - string: trim whitespace
   * - number: parse as float
   */
  transform?: TransformType;
  /** Code value mappings for 'code' transform type */
  valueMappings?: CodeMapping[];
}

/**
 * Maps a source system value to a standardized FHIR code.
 * Used for normalizing local codes to standard terminology.
 */
export interface CodeMapping {
  /** Raw value from the source file */
  sourceValue: string;
  /** Code system URI (e.g., 'http://snomed.info/sct') */
  system: string;
  /** Standardized code value */
  code: string;
  /** Human-readable display text */
  display: string;
}

/** A row after column mapping — groups mapped fields by resource type */
export interface MappedRecord {
  /** FHIR resource type this record maps to */
  resourceType: string;
  /** Mapped field values keyed by FHIR path */
  fields: Record<string, unknown>;
  /** Original source data for debugging (no PHI in logs) */
  sourceRow?: number;
}

// ── Canonical column-mapping format ("fields") ──────────────────────────────
// Định dạng chuẩn duy nhất cho CSV/Excel import (examples/column-mappings/*.json).
// Legacy formats ({mappings:[...]}, {columns:[...]}, flat {col: path}) được
// parseMappingConfig() (@fhirbridge/core) chuẩn hoá về ImportMapping bên dưới.

/** Value transforms supported by the canonical mapping format. */
export type FieldTransform = 'lowercase' | 'uppercase' | 'trim' | 'date' | 'datetime' | 'number';

/** A `fields` entry value in a mapping document: column name, column spec or literal. */
export type FieldSpec =
  | string
  | {
      /** Source column header */
      column: string;
      /** Transform applied after valueMap */
      transform?: FieldTransform;
      /** Date/datetime input format, e.g. "DD/MM/YYYY HH:mm" */
      format?: string;
      /** Source value → output value, looked up before the transform */
      valueMap?: Record<string, string>;
    }
  | {
      /** Constant value written for every row that produces the element */
      literal: string | number | boolean;
    };

/** The JSON document shape of the canonical mapping format (see mapping.schema.json). */
export interface ColumnMappingDocument {
  $schema?: string;
  description?: string;
  /** Column that identifies the patient on every row (dedupe + references) */
  patientId?: string | { column: string; system?: string };
  /** Excel sheet for all resource types, or one sheet per resource type */
  sheet?: string | Record<string, string>;
  /** UTC offset for datetimes without one, e.g. "+07:00" */
  timezone?: string;
  /** Resource types produced per row (derived from `fields` when omitted) */
  resourceTypes?: string[];
  /** "<ResourceType>.<path>" → FieldSpec */
  fields: Record<string, FieldSpec>;
}

/** Where a normalized field takes its value from. */
export type FieldSource =
  | {
      kind: 'column';
      column: string;
      transform?: FieldTransform;
      format?: string;
      valueMap?: Record<string, string>;
    }
  | { kind: 'literal'; value: string | number | boolean };

/** One path segment of a normalized FHIR path, e.g. `identifier[0]` → {name, index: 0}. */
export interface FhirPathSegment {
  name: string;
  /** Array index (always set for repeating elements after normalization) */
  index?: number;
}

/** A normalized `fields` entry. */
export interface FieldMapping {
  /** Key as written in the mapping (or synthesized from a legacy format) */
  key: string;
  resourceType: string;
  /** Normalized path below the resource with explicit indices, e.g. "name[0].given[0]" */
  path: string;
  segments: FhirPathSegment[];
  source: FieldSource;
}

/** Normalized, validated import mapping produced by parseMappingConfig(). */
export interface ImportMapping {
  description?: string;
  patientId?: { column: string; system?: string };
  sheet?: string | Record<string, string>;
  timezone?: string;
  resourceTypes: string[];
  fields: FieldMapping[];
  /** Input format the mapping was normalized from */
  sourceFormat: 'fields' | 'mappings' | 'columns' | 'flat';
  /** Non-fatal notes about the normalization (e.g. legacy conversions) */
  notices: string[];
}
