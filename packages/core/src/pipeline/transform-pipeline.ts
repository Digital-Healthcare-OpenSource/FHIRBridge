/**
 * Streaming FHIR transform pipeline.
 * Processes AsyncIterable<RawRecord> into validated FHIR Bundles via async generators.
 * Never buffers a full dataset in memory.
 *
 * Hỗ trợ AbortSignal để dừng pipeline khi client ngắt kết nối (streaming export).
 */

import type { Resource, Bundle, ValidationResult } from '@fhirbridge/types';
import { BundleBuilder } from '../bundle/bundle-builder.js';
import { validateResource } from '../validators/resource-validator.js';
import { transformToFhir, type RawRecord, type MappingConfig } from './resource-transformer.js';

/** Callback for handling validation warnings or errors during the pipeline */
export type ValidationCallback = (result: ValidationResult, resourceType: string) => void;

/** Pipeline configuration */
export interface PipelineConfig {
  /** Target FHIR resource type (e.g., 'Patient') */
  resourceType: string;
  /** Optional field mapping config */
  mappingConfig?: MappingConfig;
  /** How many resources to bundle together (default: 100) */
  batchSize?: number;
  /** Called when a resource has validation warnings */
  onValidationWarning?: ValidationCallback;
  /** If true, resources with validation errors are skipped (default: false = halt on error) */
  skipOnError?: boolean;
  /**
   * HMAC secret để hash RRN (주민등록번호) tại transform (PIPA).
   * Absent → RRN vẫn bị mask `######-*******`, không bao giờ đi tiếp dạng raw.
   */
  rrnSecret?: string;
}

/**
 * TransformPipeline: stream-processes raw records into FHIR Bundles.
 *
 * Usage:
 * ```ts
 * const pipeline = new TransformPipeline({ resourceType: 'Patient', batchSize: 50 });
 * for await (const bundle of pipeline.pipe(sourceRecords)) {
 *   const json = serializeToJson(bundle);
 *   // stream to caller
 * }
 * ```
 */
export class TransformPipeline {
  private readonly config: Required<
    Pick<PipelineConfig, 'resourceType' | 'batchSize' | 'skipOnError'>
  > &
    PipelineConfig;

  constructor(config: PipelineConfig) {
    this.config = {
      batchSize: 100,
      skipOnError: false,
      ...config,
    };
  }

  /**
   * Process an async iterable of raw records, yielding validated Bundles.
   * Each emitted Bundle contains up to `batchSize` resources.
   *
   * @param source - Async iterable of raw records from connector
   * @param signal - Optional AbortSignal; khi bị aborted, pipeline dừng ngay lập tức
   *
   * @throws DOMException với name='AbortError' nếu signal bị aborted
   * @throws Error nếu resource fails validation và skipOnError = false
   */
  async *pipe(source: AsyncIterable<RawRecord>, signal?: AbortSignal): AsyncGenerator<Bundle> {
    const { resourceType, mappingConfig, batchSize, onValidationWarning, skipOnError, rrnSecret } =
      this.config;
    let builder = new BundleBuilder();

    for await (const rawRecord of source) {
      // Kiểm tra AbortSignal trước mỗi record — dừng pipeline nếu client ngắt kết nối
      if (signal?.aborted) {
        // Cleanup upstream generator bằng cách return (kết thúc for-await-of sạch sẽ)
        return;
      }

      let resource: Resource;

      try {
        resource = transformToFhir(rawRecord, resourceType, mappingConfig, undefined, rrnSecret);
      } catch (err) {
        if (skipOnError) continue;
        throw new Error(
          `Transform failed for resourceType "${resourceType}": ${(err as Error).message}`,
        );
      }

      // Validate the transformed resource
      const validation = validateResource(resource);

      if (!validation.valid) {
        if (skipOnError) continue;
        throw new Error(
          `Validation error in "${resourceType}": ${validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
        );
      }

      // Emit warnings via callback (no PHI — only paths)
      if (validation.errors.length > 0 && onValidationWarning) {
        onValidationWarning(validation, resourceType);
      }

      builder.addResource(resource);

      // Yield a bundle when batch is full
      if (builder.getResourceCount() >= batchSize!) {
        // Kiểm tra signal lần nữa trước khi yield để tránh write sau khi stream đóng
        if (signal?.aborted) return;
        yield builder.build();
        builder = new BundleBuilder();
      }
    }

    // Yield remaining resources (nếu chưa bị abort)
    if (builder.getResourceCount() > 0 && !signal?.aborted) {
      yield builder.build();
    }
  }

  /**
   * Process raw records, yielding individual validated Resources (không wrap vào Bundle).
   * Dùng cho NDJSON streaming — mỗi resource được yield ngay không cần đợi đủ batch.
   *
   * @param source - Async iterable of raw records
   * @param signal - Optional AbortSignal để dừng stream
   */
  async *pipeResources(
    source: AsyncIterable<RawRecord>,
    signal?: AbortSignal,
  ): AsyncGenerator<Resource> {
    const { resourceType, mappingConfig, onValidationWarning, skipOnError, rrnSecret } =
      this.config;

    for await (const rawRecord of source) {
      // Dừng ngay khi signal bị aborted
      if (signal?.aborted) return;

      let resource: Resource;

      try {
        resource = transformToFhir(rawRecord, resourceType, mappingConfig, undefined, rrnSecret);
      } catch (err) {
        if (skipOnError) continue;
        throw new Error(
          `Transform failed for resourceType "${resourceType}": ${(err as Error).message}`,
        );
      }

      const validation = validateResource(resource);

      if (!validation.valid) {
        if (skipOnError) continue;
        throw new Error(
          `Validation error in "${resourceType}": ${validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
        );
      }

      if (validation.errors.length > 0 && onValidationWarning) {
        onValidationWarning(validation, resourceType);
      }

      if (signal?.aborted) return;
      yield resource;
    }
  }

  /**
   * Convenience: collect all resources into a single Bundle.
   * WARNING: loads all resources into memory — only use for small datasets.
   */
  async collect(source: AsyncIterable<RawRecord>): Promise<Bundle> {
    const builder = new BundleBuilder();

    for await (const bundle of this.pipe(source)) {
      for (const entry of bundle.entry ?? []) {
        if (entry.resource) {
          builder.addResource(entry.resource);
        }
      }
    }

    return builder.build();
  }
}

/**
 * Create an AsyncIterable from an array of records.
 * Useful for testing and small datasets.
 */
export async function* arrayToAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}
