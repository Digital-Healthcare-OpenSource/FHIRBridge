/**
 * Tests for the FHIR R4 BundleBuilder.
 * Verifies Bundle construction, UUID generation, and urn:uuid fullUrls.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BundleBuilder } from '../bundle-builder.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const patientResource = {
  resourceType: 'Patient' as const,
  id: 'patient-001',
  name: [{ family: 'Doe', given: ['Jane'] }],
  gender: 'female' as const,
  birthDate: '1985-07-22',
};

const conditionResource = {
  resourceType: 'Condition' as const,
  id: 'condition-001',
  subject: { reference: 'urn:uuid:placeholder' },
  code: {
    coding: [{ system: 'http://snomed.info/sct', code: '44054006', display: 'Type 2 diabetes' }],
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BundleBuilder', () => {
  let builder: BundleBuilder;

  beforeEach(() => {
    builder = new BundleBuilder();
  });

  it('starts with zero resources', () => {
    expect(builder.getResourceCount()).toBe(0);
  });

  it('returns a urn:uuid fullUrl when adding a resource', () => {
    const fullUrl = builder.addResource(patientResource);
    expect(fullUrl).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
  });

  it('generates unique fullUrls for each resource', () => {
    const url1 = builder.addResource(patientResource);
    const url2 = builder.addResource(conditionResource);
    expect(url1).not.toBe(url2);
  });

  it('increments resource count correctly', () => {
    builder.addResource(patientResource);
    expect(builder.getResourceCount()).toBe(1);
    builder.addResource(conditionResource);
    expect(builder.getResourceCount()).toBe(2);
  });

  it('builds a Bundle with resourceType "Bundle"', () => {
    builder.addResource(patientResource);
    const bundle = builder.build();
    expect(bundle.resourceType).toBe('Bundle');
  });

  it('builds a Bundle of type "collection"', () => {
    const bundle = builder.build();
    expect(bundle.type).toBe('collection');
  });

  it('includes all added resources in the bundle', () => {
    builder.addResource(patientResource);
    builder.addResource(conditionResource);
    const bundle = builder.build();
    expect(bundle.entry).toHaveLength(2);
  });

  it('does NOT set total on a collection bundle (FHIR R4 bdl-1)', () => {
    // bdl-1: total chỉ dành cho type 'searchset'/'history', không phải 'collection'.
    builder.addResource(patientResource);
    builder.addResource(conditionResource);
    const bundle = builder.build();
    expect(bundle.total).toBeUndefined();
  });

  it('each entry has a fullUrl matching urn:uuid pattern', () => {
    builder.addResource(patientResource);
    const bundle = builder.build();
    for (const entry of bundle.entry ?? []) {
      expect(entry.fullUrl).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    }
  });

  it('each entry contains the original resource', () => {
    builder.addResource(patientResource);
    const bundle = builder.build();
    const firstEntry = bundle.entry?.[0];
    expect(firstEntry?.resource).toMatchObject({ resourceType: 'Patient' });
  });

  it('includes a timestamp in the bundle', () => {
    const bundle = builder.build();
    expect(bundle.timestamp).toBeTruthy();
    expect(typeof bundle.timestamp).toBe('string');
  });

  it('addResourceWithUrl uses the provided fullUrl', () => {
    const customUrl = 'urn:uuid:00000000-0000-4000-a000-000000000001';
    builder.addResourceWithUrl(patientResource, customUrl);
    const bundle = builder.build();
    expect(bundle.entry?.[0]?.fullUrl).toBe(customUrl);
  });

  it('reset clears all entries', () => {
    builder.addResource(patientResource);
    builder.addResource(conditionResource);
    builder.reset();
    expect(builder.getResourceCount()).toBe(0);
  });

  it('builds an empty bundle when no resources are added', () => {
    const bundle = builder.build();
    expect(bundle.entry).toHaveLength(0);
    expect(bundle.total).toBeUndefined();
  });

  it('build can be called multiple times (snapshot semantics)', () => {
    builder.addResource(patientResource);
    const bundle1 = builder.build();
    builder.addResource(conditionResource);
    const bundle2 = builder.build();
    // bundle1 should not be mutated
    expect(bundle1.entry).toHaveLength(1);
    expect(bundle2.entry).toHaveLength(2);
  });
});
