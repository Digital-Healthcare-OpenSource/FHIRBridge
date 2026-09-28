/**
 * HisConnector interface and shared types.
 * All HIS connectors implement this adapter interface to produce a uniform
 * AsyncIterable<RawRecord> consumed by the core FHIR transform pipeline.
 */

import type { ConnectorConfig } from '@fhirbridge/types';

/**
 * A raw data record from a source system.
 * Source-agnostic container yielded by all connectors.
 */
export interface RawRecord {
  /** FHIR resource type this record represents (e.g., 'Patient', 'Observation') */
  resourceType: string;
  /** Raw field-value pairs from the source system */
  data: Record<string, unknown>;
  /** Human-readable source identifier (no PHI — e.g., 'csv:sample-patients.csv') */
  source: string;
}

/**
 * A raw tabular row (CSV line / Excel row) keyed by header name, before any mapping.
 * Excel date cells arrive as `Date` (UTC components = wall-clock in the sheet).
 */
export interface SourceRow {
  /** 1-based row/line number in the source (header = 1) */
  rowNumber: number;
  /** Excel sheet name (undefined for CSV) */
  sheet?: string;
  values: Record<string, unknown>;
}

/** Options for CsvConnector/ExcelConnector.streamRows(). */
export interface StreamRowsOptions {
  /** Excel only: sheet to read (default: config.sheetName, else the first sheet) */
  sheet?: string;
  /** Called once with the header row's column names */
  onHeaders?: (headers: string[]) => void;
}

/**
 * Health/connectivity status returned by testConnection().
 */
export interface ConnectionStatus {
  /** Whether the connector is reachable and functional */
  connected: boolean;
  /** Server software version (if available) */
  serverVersion?: string;
  /** Error message (no PHI) if connection failed */
  error?: string;
  /** Timestamp of the health check */
  checkedAt: string;
}

/**
 * Adapter interface all HIS connectors must implement.
 * Produces an AsyncIterable<RawRecord> stream consumed by TransformPipeline.
 */
export interface HisConnector {
  /** Discriminant identifying the connector variant */
  readonly type: 'fhir-endpoint' | 'csv' | 'excel';

  /**
   * Establish connection / validate file exists.
   * Must be called before fetchPatientData.
   * @throws ConnectorError on failure
   */
  connect(config: ConnectorConfig): Promise<void>;

  /**
   * Verify connectivity and return server metadata.
   * Does not require connect() to have been called first.
   */
  testConnection(): Promise<ConnectionStatus>;

  /**
   * Stream patient data as RawRecords.
   * Implementations MUST use async generators — never buffer the full dataset.
   * @param patientId - Patient identifier in the source system
   */
  fetchPatientData(patientId: string): AsyncIterable<RawRecord>;

  /**
   * Release resources: close streams, revoke tokens, etc.
   */
  disconnect(): Promise<void>;
}

/** Typed error for connector failures */
export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}
