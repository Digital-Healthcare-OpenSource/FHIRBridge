/**
 * @fhirbridge/core — security module barrel export.
 */

export { validateBaseUrl, validateBaseUrlWithDns } from './ssrf-validator.js';
export type { ValidateBaseUrlResult } from './ssrf-validator.js';
export { isValidRrn, containsRrn, maskRrn, RRN_MASK } from './rrn-detector.js';
