/**
 * FHIR R4 Patient resource validator.
 * Validates Patient-specific required and recommended fields.
 * Does NOT log PHI — only field paths are included in error messages.
 */

import type { ValidationResult, ValidationError } from '@fhirbridge/types';
import { validateResource, patterns } from './resource-validator.js';

const VALID_GENDERS = new Set(['male', 'female', 'other', 'unknown']);

/**
 * Validate a FHIR R4 Patient resource.
 * Required for clinical use: name[0].family, gender, birthDate.
 */
export function validatePatient(patient: unknown): ValidationResult {
  // Start with base resource validation
  const baseResult = validateResource(patient);
  const errors: ValidationError[] = [...baseResult.errors];

  if (!patient || typeof patient !== 'object') {
    return { valid: false, errors };
  }

  const p = patient as Record<string, unknown>;

  // Check resourceType is Patient
  if (p['resourceType'] !== 'Patient') {
    errors.push({
      path: 'resourceType',
      message: 'resourceType must be "Patient"',
      severity: 'error',
    });
  }

  // Validate name — at least one name with a family element is required
  if (!p['name']) {
    errors.push({
      path: 'name',
      message: 'Patient.name is required for identification',
      severity: 'error',
    });
  } else if (!Array.isArray(p['name']) || p['name'].length === 0) {
    errors.push({
      path: 'name',
      message: 'Patient.name must be a non-empty array',
      severity: 'error',
    });
  } else {
    const names = p['name'] as Record<string, unknown>[];
    const hasFamily = names.some(
      (n) =>
        n && typeof n === 'object' && typeof n['family'] === 'string' && n['family'].trim() !== '',
    );
    if (!hasFamily) {
      errors.push({
        path: 'name[0].family',
        message: 'At least one Patient.name must have a non-empty family (surname)',
        severity: 'error',
      });
    }
  }

  // Validate gender
  if (p['gender'] === undefined || p['gender'] === null) {
    errors.push({
      path: 'gender',
      message: 'Patient.gender is required',
      severity: 'warning',
    });
  } else if (!VALID_GENDERS.has(p['gender'] as string)) {
    errors.push({
      path: 'gender',
      message: 'Patient.gender must be one of: male, female, other, unknown',
      severity: 'error',
    });
  }

  // Validate birthDate format
  if (p['birthDate'] === undefined || p['birthDate'] === null) {
    errors.push({
      path: 'birthDate',
      message: 'Patient.birthDate is required for clinical use',
      severity: 'warning',
    });
  } else if (typeof p['birthDate'] !== 'string') {
    errors.push({
      path: 'birthDate',
      message: 'Patient.birthDate must be a string',
      severity: 'error',
    });
  } else if (!patterns.DATE.test(p['birthDate'])) {
    errors.push({
      path: 'birthDate',
      message: 'Patient.birthDate must be in YYYY-MM-DD format',
      severity: 'error',
    });
  }

  // Validate identifier if present
  if (p['identifier'] !== undefined) {
    if (!Array.isArray(p['identifier'])) {
      errors.push({
        path: 'identifier',
        message: 'Patient.identifier must be an array',
        severity: 'error',
      });
    } else {
      (p['identifier'] as unknown[]).forEach((id, i) => {
        if (!id || typeof id !== 'object') {
          errors.push({
            path: `identifier[${i}]`,
            message: 'Identifier must be an object',
            severity: 'error',
          });
        }
      });
    }
  }

  const hasErrors = errors.some((e) => e.severity === 'error');
  return { valid: !hasErrors, errors };
}
