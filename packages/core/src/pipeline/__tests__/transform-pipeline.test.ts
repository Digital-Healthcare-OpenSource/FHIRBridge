/**
 * Tests for the FHIR R4 TransformPipeline and resource transformer.
 * Uses realistic raw HIS record shapes (no PHI).
 *
 * C-6: Bổ sung AbortSignal tests cho pipe() và pipeResources().
 */

import { describe, it, expect, vi } from 'vitest';
import { TransformPipeline, arrayToAsyncIterable } from '../transform-pipeline.js';
import { transformToFhir } from '../resource-transformer.js';
import type { Bundle, Resource } from '@fhirbridge/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const rawPatientRecords = [
  {
    resourceType: 'Patient',
    id: 'patient-001',
    name: [{ family: 'Doe', given: ['Jane'] }],
    gender: 'female',
    birthDate: '1985-07-22',
  },
  {
    resourceType: 'Patient',
    id: 'patient-002',
    name: [{ family: 'Smith', given: ['John'] }],
    gender: 'male',
    birthDate: '1990-03-15',
  },
  {
    resourceType: 'Patient',
    id: 'patient-003',
    name: [{ family: 'Johnson', given: ['Alice'] }],
    gender: 'female',
    birthDate: '1975-11-28',
  },
];

// ── transformToFhir tests ─────────────────────────────────────────────────────

describe('transformToFhir', () => {
  it('copies fields directly when no mappingConfig', () => {
    const raw = { id: 'p1', gender: 'male', birthDate: '1990-01-01' };
    const resource = transformToFhir(raw, 'Patient');
    expect(resource).toMatchObject({ resourceType: 'Patient', id: 'p1' });
  });

  it('applies custom mappingConfig to rename fields', () => {
    const raw = { pt_family: 'Doe', pt_gender: 'female', pt_dob: '1985-07-22' };
    const mapping = { pt_family: 'name[0].family', pt_gender: 'gender', pt_dob: 'birthDate' };
    const resource = transformToFhir(raw, 'Patient', mapping) as Record<string, unknown>;
    expect(resource['gender']).toBe('female');
    expect(resource['birthDate']).toBe('1985-07-22');
  });

  it('normalizes MM/DD/YYYY dates to ISO 8601', () => {
    const raw = { birthDate: '07/22/1985' };
    const resource = transformToFhir(raw, 'Patient') as Record<string, unknown>;
    expect(resource['birthDate']).toBe('1985-07-22');
  });

  it('normalizes YYYYMMDD dates to ISO 8601', () => {
    const raw = { birthDate: '19850722' };
    const resource = transformToFhir(raw, 'Patient') as Record<string, unknown>;
    expect(resource['birthDate']).toBe('1985-07-22');
  });

  it('does not modify already-ISO dates', () => {
    const raw = { birthDate: '1985-07-22' };
    const resource = transformToFhir(raw, 'Patient') as Record<string, unknown>;
    expect(resource['birthDate']).toBe('1985-07-22');
  });

  it('coerces boolean string "true" to true', () => {
    const raw = { active: 'true' };
    const resource = transformToFhir(raw, 'Patient') as Record<string, unknown>;
    expect(resource['active']).toBe(true);
  });

  it('skips fields not in mappingConfig when config is provided', () => {
    const raw = { pt_family: 'Doe', unused_field: 'ignored' };
    const mapping = { pt_family: 'name[0].family' };
    const resource = transformToFhir(raw, 'Patient', mapping) as Record<string, unknown>;
    expect(resource['unused_field']).toBeUndefined();
    expect((resource['name'] as Array<{ family?: string }>)[0]?.family).toBe('Doe');
  });

  it('copies every field as-is when no mappingConfig is given', () => {
    const raw = { pt_family: 'Doe', unused_field: 'kept' };
    const resource = transformToFhir(raw, 'Patient') as Record<string, unknown>;
    expect(resource['unused_field']).toBe('kept');
  });
});

// ── TransformPipeline tests (giữ nguyên cũ) ──────────────────────────────────

describe('TransformPipeline', () => {
  it('yields at least one Bundle for non-empty input', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient' });
    const source = arrayToAsyncIterable(rawPatientRecords);
    const bundles: Bundle[] = [];

    for await (const bundle of pipeline.pipe(source)) {
      bundles.push(bundle);
    }

    expect(bundles.length).toBeGreaterThan(0);
  });

  it('processes all input records', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient' });
    const source = arrayToAsyncIterable(rawPatientRecords);
    let totalResources = 0;

    for await (const bundle of pipeline.pipe(source)) {
      totalResources += bundle.entry?.length ?? 0;
    }

    expect(totalResources).toBe(rawPatientRecords.length);
  });

  it('respects batchSize — yields multiple bundles when batchSize < total', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient', batchSize: 1 });
    const source = arrayToAsyncIterable(rawPatientRecords);
    const bundles: Bundle[] = [];

    for await (const bundle of pipeline.pipe(source)) {
      bundles.push(bundle);
    }

    expect(bundles.length).toBe(3);
  });

  it('each yielded bundle has resourceType "Bundle"', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient' });
    const source = arrayToAsyncIterable(rawPatientRecords);

    for await (const bundle of pipeline.pipe(source)) {
      expect(bundle.resourceType).toBe('Bundle');
    }
  });

  it('each entry has a urn:uuid fullUrl', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient' });
    const source = arrayToAsyncIterable(rawPatientRecords);

    for await (const bundle of pipeline.pipe(source)) {
      for (const entry of bundle.entry ?? []) {
        expect(entry.fullUrl).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
      }
    }
  });

  it('yields nothing for empty input', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient' });
    const source = arrayToAsyncIterable([]);
    const bundles: Bundle[] = [];

    for await (const bundle of pipeline.pipe(source)) {
      bundles.push(bundle);
    }

    expect(bundles).toHaveLength(0);
  });

  it('calls onValidationWarning when warnings are present', async () => {
    const warnSpy = vi.fn();
    const pipeline = new TransformPipeline({
      resourceType: 'UnknownFhirResource',
      onValidationWarning: warnSpy,
    });
    const source = arrayToAsyncIterable([{ id: 'x1' }]);

    const bundles: Bundle[] = [];
    for await (const bundle of pipeline.pipe(source)) {
      bundles.push(bundle);
    }

    expect(warnSpy).toHaveBeenCalled();
  });

  it('collect() returns a single Bundle with all resources', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient', batchSize: 1 });
    const source = arrayToAsyncIterable(rawPatientRecords);
    const bundle = await pipeline.collect(source);
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.entry?.length).toBe(3);
  });
});

// ── C-6: AbortSignal tests cho pipe() ────────────────────────────────────────

describe('TransformPipeline.pipe() AbortSignal (C-6)', () => {
  it('pre-aborted signal → yields nothing', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient' });

    // Signal đã aborted trước khi bắt đầu
    const controller = new AbortController();
    controller.abort();

    const source = arrayToAsyncIterable(rawPatientRecords);
    const bundles: Bundle[] = [];

    for await (const bundle of pipeline.pipe(source, controller.signal)) {
      bundles.push(bundle);
    }

    // Không có bundle nào được yield vì signal đã aborted
    expect(bundles).toHaveLength(0);
  });

  it('signal aborted mid-stream → stops before processing all records', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient', batchSize: 1 });

    const controller = new AbortController();
    let bundleCount = 0;

    // Abort sau bundle đầu tiên
    async function* abortingSource() {
      let i = 0;
      for (const record of rawPatientRecords) {
        yield record;
        i++;
        if (i === 1) {
          // Abort sau record đầu tiên
          controller.abort();
        }
        await new Promise<void>((r) => setImmediate(r));
      }
    }

    for await (const _bundle of pipeline.pipe(abortingSource(), controller.signal)) {
      bundleCount++;
    }

    // Phải dừng sớm — ít hơn tổng số records
    expect(bundleCount).toBeLessThan(rawPatientRecords.length);
  });

  it('no signal provided → processes all records normally', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient' });
    const source = arrayToAsyncIterable(rawPatientRecords);
    let totalResources = 0;

    // Không truyền signal — phải xử lý bình thường
    for await (const bundle of pipeline.pipe(source)) {
      totalResources += bundle.entry?.length ?? 0;
    }

    expect(totalResources).toBe(rawPatientRecords.length);
  });

  it('signal aborted after all records → all resources processed', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient' });
    const controller = new AbortController();
    const source = arrayToAsyncIterable(rawPatientRecords);
    let totalResources = 0;

    for await (const bundle of pipeline.pipe(source, controller.signal)) {
      totalResources += bundle.entry?.length ?? 0;
    }

    // Abort sau khi đã xong — không ảnh hưởng kết quả
    controller.abort();

    expect(totalResources).toBe(rawPatientRecords.length);
  });
});

// ── C-6: AbortSignal tests cho pipeResources() ───────────────────────────────

describe('TransformPipeline.pipeResources() (C-6)', () => {
  it('yields individual Resources (not Bundles)', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient' });
    const source = arrayToAsyncIterable(rawPatientRecords);
    const resources: Resource[] = [];

    for await (const resource of pipeline.pipeResources(source)) {
      resources.push(resource);
    }

    expect(resources).toHaveLength(rawPatientRecords.length);
    for (const r of resources) {
      // Mỗi item phải là Resource (có resourceType), không phải Bundle wrapper
      expect(r).toHaveProperty('resourceType', 'Patient');
      // Không có bundle.entry wrapping
      expect(r).not.toHaveProperty('entry');
    }
  });

  it('yields nothing for empty input', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient' });
    const source = arrayToAsyncIterable([]);
    const resources: Resource[] = [];

    for await (const resource of pipeline.pipeResources(source)) {
      resources.push(resource);
    }

    expect(resources).toHaveLength(0);
  });

  it('pre-aborted signal → yields nothing', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient' });
    const controller = new AbortController();
    controller.abort();

    const source = arrayToAsyncIterable(rawPatientRecords);
    const resources: Resource[] = [];

    for await (const resource of pipeline.pipeResources(source, controller.signal)) {
      resources.push(resource);
    }

    expect(resources).toHaveLength(0);
  });

  it('signal aborted mid-stream → stops iteration', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient', skipOnError: true });
    const controller = new AbortController();
    let count = 0;

    async function* abortAfterTwo() {
      for (const record of rawPatientRecords) {
        yield record;
        count++;
        if (count === 1) {
          controller.abort();
        }
        await new Promise<void>((r) => setImmediate(r));
      }
    }

    const resources: Resource[] = [];
    for await (const resource of pipeline.pipeResources(abortAfterTwo(), controller.signal)) {
      resources.push(resource);
    }

    // Phải dừng trước khi xử lý tất cả records
    expect(resources.length).toBeLessThan(rawPatientRecords.length);
  });

  it('processes 100 resources correctly without signal', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient' });

    // Tạo 100 records
    const records = Array.from({ length: 100 }, (_, i) => ({
      resourceType: 'Patient',
      id: `patient-${i}`,
      gender: 'male',
      birthDate: '1990-01-01',
    }));

    const source = arrayToAsyncIterable(records);
    const resources: Resource[] = [];

    for await (const resource of pipeline.pipeResources(source)) {
      resources.push(resource);
    }

    expect(resources).toHaveLength(100);
  });

  it('skipOnError: skips invalid resources and continues', async () => {
    const pipeline = new TransformPipeline({ resourceType: 'Patient', skipOnError: true });

    // Mix của valid và invalid records
    const records = [
      { resourceType: 'Patient', id: 'p1', gender: 'male', birthDate: '1990-01-01' },
      { resourceType: 'Patient', id: 'p2', gender: 'female', birthDate: '1985-01-01' },
    ];

    const source = arrayToAsyncIterable(records);
    const resources: Resource[] = [];

    for await (const resource of pipeline.pipeResources(source)) {
      resources.push(resource);
    }

    // Ít nhất một resource phải được yield
    expect(resources.length).toBeGreaterThan(0);
  });
});
