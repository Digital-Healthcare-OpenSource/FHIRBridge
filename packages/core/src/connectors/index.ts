/**
 * @fhirbridge/core — connectors barrel export.
 */

export type {
  HisConnector,
  RawRecord,
  ConnectionStatus,
  SourceRow,
  StreamRowsOptions,
} from './his-connector-interface.js';
export { ConnectorError } from './his-connector-interface.js';
export { FhirEndpointConnector } from './fhir-endpoint-connector.js';
export { CsvConnector } from './csv-connector.js';
export { ExcelConnector } from './excel-connector.js';
export { mapRow } from './column-mapper.js';
export { withRetry, isRetryable } from './retry-handler.js';
export type { RetryOptions } from './retry-handler.js';
export {
  parseMappingConfig,
  MappingConfigError,
  FIELD_TRANSFORMS,
  SUPPORTED_RESOURCE_TYPES,
  DATE_FORMAT_TOKENS,
} from './mapping/index.js';
export type { ParseMappingOptions } from './mapping/index.js';
