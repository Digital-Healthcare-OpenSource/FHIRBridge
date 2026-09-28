/**
 * Connector configuration types.
 * Defines config shapes for FHIR endpoint and file-based HIS connectors.
 */

import type { ColumnMapping } from './mapping-config.js';

/** Union type covering all connector configuration variants */
export type ConnectorConfig = FhirEndpointConfig | FileImportConfig;

/** Connector type discriminant */
export type ConnectorType = 'fhir-endpoint' | 'csv' | 'excel';

/**
 * Configuration for a SMART on FHIR R4 endpoint connector.
 * Supports standalone OAuth2 launch with client credentials.
 */
export interface FhirEndpointConfig {
  readonly type: 'fhir-endpoint';
  /** Base URL of the FHIR server (e.g., https://hapi.fhir.org/baseR4) */
  baseUrl: string;
  /** OAuth2 client ID for SMART authentication */
  clientId?: string;
  /** OAuth2 client secret (stored in memory only, never logged) */
  clientSecret?: string;
  /** OAuth2 scopes (e.g., 'patient/*.read') */
  scope?: string;
  /** Token endpoint URL for OAuth2 exchange */
  tokenEndpoint?: string;
  /** OAuth2 redirect URI for standalone launch */
  redirectUri?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Number of resources per paginated request (default: 100) */
  pageCount?: number;
}

/**
 * Configuration for CSV or Excel file import connectors.
 * Specifies file location, format hints, and column-to-FHIR mapping.
 */
export interface FileImportConfig {
  readonly type: 'csv' | 'excel';
  /** Absolute path to the import file */
  filePath: string;
  /** Sheet name for Excel files (defaults to first sheet) */
  sheetName?: string;
  /** Column delimiter for CSV (auto-detected if omitted) */
  delimiter?: string;
  /** Row index (0-based) where headers reside (default: 0) */
  headerRow?: number;
  /** File encoding (default: 'utf-8') */
  encoding?: 'utf-8' | 'utf8' | 'utf-16le' | 'utf16le' | 'latin1' | 'ascii' | 'shift_jis';
  /**
   * Legacy column-to-FHIR field mappings used by fetchPatientData().
   * Optional: streamRows() reads raw rows and ignores it (default []).
   */
  mapping?: ColumnMapping[];
  /** Column name containing patient identifier for filtering */
  patientIdColumn?: string;
}
