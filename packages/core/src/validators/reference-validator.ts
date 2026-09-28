/**
 * FHIR R4 Reference validator.
 * Validates reference format and optionally resolves references within a Bundle.
 */

import type { Bundle, ValidationResult, ValidationError } from '@fhirbridge/types';
import { patterns } from './resource-validator.js';

/**
 * Validate a single FHIR Reference.
 * Accepts: urn:uuid:{uuid}, relative (ResourceType/id), or absolute URL.
 */
export function validateReference(ref: unknown, path = 'reference'): ValidationResult {
  const errors: ValidationError[] = [];

  if (!ref || typeof ref !== 'object') {
    errors.push({ path, message: 'Reference must be a non-null object', severity: 'error' });
    return { valid: false, errors };
  }

  const r = ref as Record<string, unknown>;

  // A Reference must have at least one of: reference, identifier, display
  if (r['reference'] === undefined && r['identifier'] === undefined && r['display'] === undefined) {
    errors.push({
      path,
      message: 'Reference must have at least one of: reference, identifier, display',
      severity: 'error',
    });
    return { valid: false, errors };
  }

  if (r['reference'] !== undefined) {
    if (typeof r['reference'] !== 'string') {
      errors.push({
        path: `${path}.reference`,
        message: 'Reference.reference must be a string',
        severity: 'error',
      });
    } else {
      const refStr = r['reference'] as string;
      const isUrnUuid = patterns.URN_UUID.test(refStr);
      const isRelative = patterns.RELATIVE_REF.test(refStr);
      const isAbsolute = refStr.startsWith('http://') || refStr.startsWith('https://');

      if (!isUrnUuid && !isRelative && !isAbsolute) {
        errors.push({
          path: `${path}.reference`,
          message:
            'Reference.reference must be a urn:uuid, relative (ResourceType/id), or absolute URL',
          severity: 'error',
        });
      }
    }
  }

  const hasErrors = errors.some((e) => e.severity === 'error');
  return { valid: !hasErrors, errors };
}

/**
 * Validate a reference and also attempt to resolve it within a Bundle.
 * Adds a warning (not error) if the reference cannot be resolved in the bundle.
 */
export function validateReferenceInBundle(
  ref: unknown,
  bundle: Bundle,
  path = 'reference',
): ValidationResult {
  const result = validateReference(ref, path);
  if (!result.valid) return result;

  const r = ref as Record<string, unknown>;
  if (typeof r['reference'] !== 'string') return result;

  const refStr = r['reference'] as string;

  // Only attempt resolution for urn:uuid and relative references
  if (!patterns.URN_UUID.test(refStr) && !patterns.RELATIVE_REF.test(refStr)) {
    return result;
  }

  const entries = bundle.entry ?? [];
  const resolved = entries.some((entry) => {
    if (patterns.URN_UUID.test(refStr)) {
      return entry.fullUrl === refStr;
    }
    // Relative reference: ResourceType/id — check resource id
    if (entry.resource) {
      const res = entry.resource as unknown as Record<string, unknown>;
      const [resourceType, id] = refStr.split('/');
      return res['resourceType'] === resourceType && res['id'] === id;
    }
    return false;
  });

  if (!resolved) {
    result.errors.push({
      path: `${path}.reference`,
      message: 'Reference could not be resolved within the Bundle',
      severity: 'warning',
    });
  }

  return result;
}
