/**
 * JSON Schema definitions for connector routes.
 */

export const connectorTestRequestSchema = {
  type: 'object',
  required: ['type', 'config'],
  properties: {
    type: { type: 'string', enum: ['fhir-endpoint'] },
    config: {
      type: 'object',
      required: ['baseUrl'],
      properties: {
        baseUrl: { type: 'string', minLength: 1 },
        clientId: { type: 'string' },
        clientSecret: { type: 'string' },
        tokenEndpoint: { type: 'string' },
        timeout: { type: 'number' },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: false,
} as const;

export const postConnectorTestSchema = {
  body: connectorTestRequestSchema,
  response: {
    200: {
      type: 'object',
      properties: {
        connected: { type: 'boolean' },
        serverVersion: { type: 'string' },
        error: { type: 'string' },
        checkedAt: { type: 'string' },
      },
    },
  },
} as const;

// ── POST /api/v1/connectors/import (multipart) ──────────────────────────────

/** Multipart field names accepted by the import route. */
export const IMPORT_FIELDS = {
  /** The CSV / .xlsx upload (file part) */
  file: 'file',
  /** Column mapping JSON — text field or file part */
  mapping: 'mapping',
  /** Optional Excel sheet override (text field) */
  sheet: 'sheet',
} as const;

/** Upper bound for the mapping JSON (text field or file part). */
export const MAX_MAPPING_BYTES = 256 * 1024;

/** Safety limit on resources per import request. */
export const MAX_IMPORT_RESOURCES = 10_000;

/** Max per-row warnings echoed back in the response (the count is always exact). */
export const MAX_IMPORT_WARNINGS = 50;

/** Error message when no mapping part is sent (documented in examples/README.md). */
export const MAPPING_REQUIRED_MESSAGE =
  'No column mapping provided. Send the mapping JSON as the multipart field "mapping" ' +
  '(text field or file part) next to the upload in "file". Start from one of ' +
  'examples/column-mappings/*.json — see examples/README.md.';

/**
 * Route schema — documentation only: multipart bodies are validated in the
 * handler (parseMappingConfig), not by Ajv, and the response has no schema so
 * the FHIR bundle is serialized untouched.
 */
export const postConnectorImportSchema = {
  consumes: ['multipart/form-data'],
  summary: 'Import a CSV / Excel file into a FHIR R4 collection Bundle',
  description:
    'Multipart fields: "file" (CSV or .xlsx upload, required), "mapping" (column mapping JSON ' +
    'as a text field or file part, required — canonical "fields" format, see ' +
    'examples/column-mappings/), "sheet" (optional Excel sheet override). Responds with ' +
    '{message, resourceCount, resourcesByType, rowsRead, warnings, warningCount, bundle}.',
} as const;
