/**
 * FHIR R4 Coding and CodeableConcept validator.
 * Validates coding system URIs, code format, and known systems.
 */

import type { ValidationResult, ValidationError } from '@fhirbridge/types';
import { KNOWN_SYSTEMS } from '../coding/index.js';

/** Validate a URI string is well-formed */
function isValidUri(uri: string): boolean {
  try {
    new URL(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a single FHIR Coding element.
 * @param coding - The Coding to validate
 * @param path - JSONPath prefix for error messages
 * @param expectedSystem - Optional: assert coding belongs to this system
 */
export function validateCoding(
  coding: unknown,
  path = 'coding',
  expectedSystem?: string,
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!coding || typeof coding !== 'object') {
    errors.push({ path, message: 'Coding must be a non-null object', severity: 'error' });
    return { valid: false, errors };
  }

  const c = coding as Record<string, unknown>;

  // system — strongly recommended
  if (c['system'] === undefined) {
    errors.push({
      path: `${path}.system`,
      message: 'Coding.system is strongly recommended',
      severity: 'warning',
    });
  } else if (typeof c['system'] !== 'string') {
    errors.push({
      path: `${path}.system`,
      message: 'Coding.system must be a string URI',
      severity: 'error',
    });
  } else {
    if (!isValidUri(c['system'])) {
      errors.push({
        path: `${path}.system`,
        message: 'Coding.system must be a valid URI',
        severity: 'error',
      });
    }
    if (!(KNOWN_SYSTEMS as Set<string>).has(c['system'] as string)) {
      errors.push({
        path: `${path}.system`,
        message: 'Coding.system is not a recognized FHIR terminology URI',
        severity: 'warning',
      });
    }
    if (expectedSystem && c['system'] !== expectedSystem) {
      errors.push({
        path: `${path}.system`,
        message: `Coding.system must be "${expectedSystem}"`,
        severity: 'error',
      });
    }
  }

  // code — required for meaningful exchange
  if (c['code'] === undefined || c['code'] === null) {
    errors.push({ path: `${path}.code`, message: 'Coding.code is required', severity: 'error' });
  } else if (typeof c['code'] !== 'string') {
    errors.push({
      path: `${path}.code`,
      message: 'Coding.code must be a string',
      severity: 'error',
    });
  } else if (c['code'].trim() === '') {
    errors.push({
      path: `${path}.code`,
      message: 'Coding.code must not be empty',
      severity: 'error',
    });
  }

  // display — optional but recommended
  if (c['display'] !== undefined && typeof c['display'] !== 'string') {
    errors.push({
      path: `${path}.display`,
      message: 'Coding.display must be a string',
      severity: 'warning',
    });
  }

  const hasErrors = errors.some((e) => e.severity === 'error');
  return { valid: !hasErrors, errors };
}

/**
 * Validate a FHIR CodeableConcept.
 * Either coding[0] or text must be present.
 */
export function validateCodeableConcept(
  concept: unknown,
  path = 'codeableConcept',
  expectedSystem?: string,
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!concept || typeof concept !== 'object') {
    errors.push({ path, message: 'CodeableConcept must be a non-null object', severity: 'error' });
    return { valid: false, errors };
  }

  const cc = concept as Record<string, unknown>;

  // Require at least coding or text
  if (!cc['coding'] && !cc['text']) {
    errors.push({
      path,
      message: 'CodeableConcept must have at least a coding or text element',
      severity: 'error',
    });
  }

  // Validate each coding entry
  if (cc['coding'] !== undefined) {
    if (!Array.isArray(cc['coding'])) {
      errors.push({
        path: `${path}.coding`,
        message: 'coding must be an array',
        severity: 'error',
      });
    } else {
      (cc['coding'] as unknown[]).forEach((coding, i) => {
        const result = validateCoding(coding, `${path}.coding[${i}]`, expectedSystem);
        errors.push(...result.errors);
      });
    }
  }

  if (cc['text'] !== undefined && typeof cc['text'] !== 'string') {
    errors.push({
      path: `${path}.text`,
      message: 'CodeableConcept.text must be a string',
      severity: 'error',
    });
  }

  const hasErrors = errors.some((e) => e.severity === 'error');
  return { valid: !hasErrors, errors };
}
