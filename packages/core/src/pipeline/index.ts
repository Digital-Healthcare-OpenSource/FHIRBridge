/**
 * @fhirbridge/core — pipeline utilities barrel export.
 */

export { transformToFhir } from './resource-transformer.js';
export type { RawRecord, MappingConfig } from './resource-transformer.js';

export { TransformPipeline, arrayToAsyncIterable } from './transform-pipeline.js';
export type { PipelineConfig, ValidationCallback } from './transform-pipeline.js';

export {
  RowTransformer,
  transformRows,
  formatImportIssue,
  deterministicUuid,
} from './row-transformer.js';
export type {
  TabularRow,
  ImportIssue,
  ImportStats,
  TransformedResource,
  RowTransformerOptions,
} from './row-transformer.js';

export {
  importTabularFile,
  detectTabularFileType,
  assertTabularContent,
  TabularImportError,
} from './tabular-import.js';
export type {
  TabularFileType,
  TabularImportOptions,
  TabularImportResult,
  TabularImportErrorCode,
} from './tabular-import.js';
