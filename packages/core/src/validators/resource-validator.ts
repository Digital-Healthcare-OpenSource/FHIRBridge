/**
 * Base FHIR resource validator.
 * Validates common fields present on all FHIR resources.
 * Does NOT log resource content — only field paths are referenced in errors.
 *
 * Includes FHIR R4 §MedicationRequest medication[x] choice enforcement:
 * exactly one of medicationCodeableConcept | medicationReference must be present.
 */

import type { Resource, ValidationResult, ValidationError } from '@fhirbridge/types';

/** UUID v4 pattern (with or without urn:uuid: prefix) */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** urn:uuid pattern for fullUrl references */
const URN_UUID_PATTERN =
  /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Relative reference pattern (e.g., Patient/123) */
const RELATIVE_REF_PATTERN = /^[A-Z][a-zA-Z]+\/[^/\s]+$/;

/**
 * FHIR R4 `date` pattern — allows partial precision: YYYY, YYYY-MM, or YYYY-MM-DD.
 * Spec: https://hl7.org/fhir/R4/datatypes.html#date
 * (e.g. Patient.birthDate = '1985' is a valid FHIR date.)
 */
const DATE_PATTERN = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

/**
 * FHIR R4 `dateTime` pattern — partial precision (YYYY, YYYY-MM, YYYY-MM-DD) allowed,
 * but when a time is present it MUST include seconds AND a timezone offset (Z or ±hh:mm).
 * Spec: https://hl7.org/fhir/R4/datatypes.html#dateTime
 */
const DATETIME_PATTERN =
  /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d))?)?)?$/;

/** Known FHIR R4 resource types */
const KNOWN_RESOURCE_TYPES = new Set([
  'Patient',
  'Encounter',
  'Condition',
  'Observation',
  'MedicationRequest',
  'AllergyIntolerance',
  'Procedure',
  'DiagnosticReport',
  'Bundle',
  'Composition',
  'Practitioner',
  'Organization',
  'Location',
  'Device',
  'Medication',
  'Immunization',
  'CarePlan',
  'CareTeam',
  'Goal',
  'ServiceRequest',
  'DocumentReference',
  'Specimen',
]);

/**
 * Enforce FHIR R4 §MedicationRequest medication[x] choice constraint.
 * Exactly one of medicationCodeableConcept | medicationReference must be present.
 * @returns ValidationError nếu vi phạm, null nếu hợp lệ
 */
function validateMedicationChoice(res: Record<string, unknown>): ValidationError | null {
  const hasCC = res['medicationCodeableConcept'] != null;
  const hasRef = res['medicationReference'] != null;

  if (hasCC && hasRef) {
    return {
      path: 'medication[x]',
      message:
        'MedicationRequest.medication[x] violates choice: both medicationCodeableConcept and ' +
        'medicationReference present (FHIR R4 §MedicationRequest)',
      severity: 'error',
    };
  }
  if (!hasCC && !hasRef) {
    return {
      path: 'medication[x]',
      message:
        'MedicationRequest.medication[x] is required: either medicationCodeableConcept or ' +
        'medicationReference must be present',
      severity: 'error',
    };
  }
  return null;
}

/**
 * Kiểm tra các phần tử bắt buộc (cardinality 1..1) có mặt hay không.
 * Trả về một ValidationError cho mỗi field thiếu (null/undefined).
 */
function requirePresent(
  res: Record<string, unknown>,
  resourceType: string,
  fields: readonly string[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const field of fields) {
    if (res[field] === undefined || res[field] === null) {
      errors.push({
        path: field,
        message: `${resourceType}.${field} is required (FHIR R4 cardinality 1..1)`,
        severity: 'error',
      });
    }
  }
  return errors;
}

/**
 * Required-element validators cho các resource type chưa có dedicated validator.
 * Mỗi entry liệt kê field bắt buộc theo FHIR R4 base spec. Được dispatch trong
 * validateResource() dựa vào resourceType.
 */
const REQUIRED_ELEMENTS: Readonly<Record<string, readonly string[]>> = {
  Observation: ['status', 'code'],
  Condition: ['subject'],
  Encounter: ['status', 'class'],
  DiagnosticReport: ['status', 'code'],
  Procedure: ['status', 'subject'],
  AllergyIntolerance: ['patient'],
  MedicationRequest: ['status', 'intent', 'subject'],
};

/**
 * Validate a base FHIR resource for common structural requirements.
 * Checks: resourceType, id format, meta structure.
 */
export function validateResource(resource: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!resource || typeof resource !== 'object') {
    errors.push({
      path: '$',
      message: 'Resource must be a non-null object',
      severity: 'error',
    });
    return { valid: false, errors };
  }

  const res = resource as Record<string, unknown>;

  // Check resourceType
  if (!res['resourceType']) {
    errors.push({ path: 'resourceType', message: 'resourceType is required', severity: 'error' });
  } else if (typeof res['resourceType'] !== 'string') {
    errors.push({
      path: 'resourceType',
      message: 'resourceType must be a string',
      severity: 'error',
    });
  } else if (!KNOWN_RESOURCE_TYPES.has(res['resourceType'] as string)) {
    errors.push({
      path: 'resourceType',
      message: `Unknown resourceType — not a recognized FHIR R4 resource`,
      severity: 'warning',
    });
  }

  // Check id format if present
  if (res['id'] !== undefined) {
    if (typeof res['id'] !== 'string') {
      errors.push({ path: 'id', message: 'id must be a string', severity: 'error' });
    } else if (res['id'].trim() === '') {
      errors.push({ path: 'id', message: 'id must not be empty', severity: 'error' });
    }
  }

  // Check meta structure if present
  if (res['meta'] !== undefined) {
    if (typeof res['meta'] !== 'object' || res['meta'] === null) {
      errors.push({ path: 'meta', message: 'meta must be an object', severity: 'error' });
    } else {
      const meta = res['meta'] as Record<string, unknown>;
      if (meta['lastUpdated'] !== undefined && typeof meta['lastUpdated'] !== 'string') {
        errors.push({
          path: 'meta.lastUpdated',
          message: 'meta.lastUpdated must be a string',
          severity: 'warning',
        });
      }
      if (meta['lastUpdated'] && typeof meta['lastUpdated'] === 'string') {
        if (!DATETIME_PATTERN.test(meta['lastUpdated'])) {
          errors.push({
            path: 'meta.lastUpdated',
            message: 'meta.lastUpdated must be a valid datetime',
            severity: 'warning',
          });
        }
      }
    }
  }

  // ── Resource-specific required-element dispatch ─────────────────────────────
  const resourceType = typeof res['resourceType'] === 'string' ? res['resourceType'] : undefined;
  const requiredFields = resourceType ? REQUIRED_ELEMENTS[resourceType] : undefined;
  if (resourceType && requiredFields) {
    errors.push(...requirePresent(res, resourceType, requiredFields));
  }

  // MedicationRequest: medication[x] choice (FHIR R4 §MedicationRequest)
  if (resourceType === 'MedicationRequest') {
    const choiceError = validateMedicationChoice(res);
    if (choiceError) errors.push(choiceError);
  }

  const hasErrors = errors.some((e) => e.severity === 'error');
  return { valid: !hasErrors, errors };
}

/** Exported patterns for reuse in child validators */
export const patterns = {
  UUID: UUID_PATTERN,
  URN_UUID: URN_UUID_PATTERN,
  RELATIVE_REF: RELATIVE_REF_PATTERN,
  DATE: DATE_PATTERN,
  DATETIME: DATETIME_PATTERN,
};
