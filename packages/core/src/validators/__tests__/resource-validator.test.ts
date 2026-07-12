/**
 * Tests for the base FHIR resource validator.
 * Uses realistic FHIR R4 resource shapes (no PHI).
 */

import { describe, it, expect } from 'vitest';
import { validateResource, patterns } from '../resource-validator.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const validPatientResource = {
  resourceType: 'Patient',
  id: 'test-patient-001',
  meta: {
    versionId: '1',
    lastUpdated: '2024-01-15T10:30:00Z',
  },
  name: [{ family: 'Smith', given: ['John'] }],
};

const validObservationResource = {
  resourceType: 'Observation',
  id: 'obs-001',
  status: 'final',
  code: { coding: [{ system: 'http://loinc.org', code: '8310-5', display: 'Body temperature' }] },
  subject: { reference: 'urn:uuid:a7e3f001-1234-4321-abcd-fedcba987654' },
};

// ── Test: Valid resources ─────────────────────────────────────────────────────

describe('validateResource', () => {
  it('returns valid for a well-formed Patient resource', () => {
    const result = validateResource(validPatientResource);
    expect(result.valid).toBe(true);
    expect(result.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
  });

  it('returns valid for a well-formed Observation resource', () => {
    const result = validateResource(validObservationResource);
    expect(result.valid).toBe(true);
  });

  it('returns valid for resource with no id (id is optional)', () => {
    // Condition requires subject (1..1); include it so we isolate the id-optional check.
    const result = validateResource({
      resourceType: 'Condition',
      subject: { reference: 'Patient/p1' },
    });
    expect(result.valid).toBe(true);
  });

  // ── Test: Missing required fields ─────────────────────────────────────────

  it('returns invalid when resource is null', () => {
    const result = validateResource(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.severity).toBe('error');
  });

  it('returns invalid when resource is not an object', () => {
    const result = validateResource('not-an-object');
    expect(result.valid).toBe(false);
  });

  it('returns error when resourceType is missing', () => {
    const result = validateResource({ id: 'test' });
    const errors = result.errors.filter((e) => e.path === 'resourceType' && e.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(result.valid).toBe(false);
  });

  it('returns error when resourceType is not a string', () => {
    const result = validateResource({ resourceType: 42 });
    expect(result.valid).toBe(false);
  });

  it('returns warning for unknown resourceType', () => {
    const result = validateResource({ resourceType: 'UnknownFhirResource' });
    const warnings = result.errors.filter(
      (e) => e.severity === 'warning' && e.path === 'resourceType',
    );
    expect(warnings.length).toBeGreaterThan(0);
    // Should still be valid (only errors invalidate)
    expect(result.valid).toBe(true);
  });

  // ── Test: id validation ───────────────────────────────────────────────────

  it('returns error when id is not a string', () => {
    const result = validateResource({ resourceType: 'Patient', id: 123 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'id')).toBe(true);
  });

  it('returns error when id is empty string', () => {
    const result = validateResource({ resourceType: 'Patient', id: '' });
    expect(result.valid).toBe(false);
  });

  // ── Test: meta validation ─────────────────────────────────────────────────

  it('returns error when meta is not an object', () => {
    const result = validateResource({ resourceType: 'Patient', meta: 'invalid' });
    expect(result.valid).toBe(false);
  });

  it('returns warning when meta.lastUpdated is not a valid datetime', () => {
    const result = validateResource({
      resourceType: 'Patient',
      meta: { lastUpdated: 'not-a-date' },
    });
    const warnings = result.errors.filter(
      (e) => e.path === 'meta.lastUpdated' && e.severity === 'warning',
    );
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('accepts valid ISO 8601 datetime in meta.lastUpdated', () => {
    const result = validateResource({
      resourceType: 'Patient',
      meta: { lastUpdated: '2024-03-15T14:22:33+05:30' },
    });
    expect(result.errors.filter((e) => e.path === 'meta.lastUpdated')).toHaveLength(0);
  });

  // ── Test: MedicationRequest.medication[x] choice enforcement ─────────────────
  // Spec: FHIR R4 §MedicationRequest — exactly one of medicationCodeableConcept | medicationReference

  it('accepts MedicationRequest with only medicationCodeableConcept', () => {
    const result = validateResource({
      resourceType: 'MedicationRequest',
      id: 'med-req-001',
      status: 'active',
      intent: 'order',
      medicationCodeableConcept: {
        coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '1049502' }],
      },
      subject: { reference: 'Patient/patient-001' },
    });
    expect(result.errors.filter((e) => e.path === 'medication[x]')).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('accepts MedicationRequest with only medicationReference', () => {
    const result = validateResource({
      resourceType: 'MedicationRequest',
      id: 'med-req-002',
      status: 'active',
      intent: 'order',
      medicationReference: { reference: 'Medication/med-001' },
      subject: { reference: 'Patient/patient-001' },
    });
    expect(result.errors.filter((e) => e.path === 'medication[x]')).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('returns error when MedicationRequest has both medicationCodeableConcept and medicationReference', () => {
    const result = validateResource({
      resourceType: 'MedicationRequest',
      id: 'med-req-003',
      status: 'active',
      intent: 'order',
      medicationCodeableConcept: {
        coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '1049502' }],
      },
      medicationReference: { reference: 'Medication/med-001' },
      subject: { reference: 'Patient/patient-001' },
    });
    const choiceErrors = result.errors.filter(
      (e) => e.path === 'medication[x]' && e.severity === 'error',
    );
    expect(choiceErrors).toHaveLength(1);
    expect(choiceErrors[0]?.message).toMatch(/both/);
    expect(result.valid).toBe(false);
  });

  it('returns error when MedicationRequest has neither medicationCodeableConcept nor medicationReference', () => {
    const result = validateResource({
      resourceType: 'MedicationRequest',
      id: 'med-req-004',
      status: 'active',
      intent: 'order',
      subject: { reference: 'Patient/patient-001' },
    });
    const choiceErrors = result.errors.filter(
      (e) => e.path === 'medication[x]' && e.severity === 'error',
    );
    expect(choiceErrors).toHaveLength(1);
    expect(choiceErrors[0]?.message).toMatch(/required/);
    expect(result.valid).toBe(false);
  });

  it('does not apply medication[x] check to non-MedicationRequest resources', () => {
    // Observation without medication fields — should NOT produce medication[x] errors
    const result = validateResource({
      resourceType: 'Observation',
      id: 'obs-002',
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '8310-5' }] },
    });
    const choiceErrors = result.errors.filter((e) => e.path === 'medication[x]');
    expect(choiceErrors).toHaveLength(0);
  });

  // ── Required-element dispatch (7 previously-uncovered types) ─────────────────

  it('Observation missing status fails validation', () => {
    const result = validateResource({
      resourceType: 'Observation',
      code: { coding: [{ system: 'http://loinc.org', code: '8310-5' }] },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'status' && e.severity === 'error')).toBe(true);
  });

  it('Observation missing code fails validation', () => {
    const result = validateResource({ resourceType: 'Observation', status: 'final' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'code' && e.severity === 'error')).toBe(true);
  });

  it('Encounter missing class fails validation', () => {
    const result = validateResource({ resourceType: 'Encounter', status: 'finished' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'class' && e.severity === 'error')).toBe(true);
  });

  it('AllergyIntolerance missing patient fails validation', () => {
    const result = validateResource({ resourceType: 'AllergyIntolerance' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'patient' && e.severity === 'error')).toBe(true);
  });

  it('Procedure missing status and subject fails validation', () => {
    const result = validateResource({ resourceType: 'Procedure' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'status')).toBe(true);
    expect(result.errors.some((e) => e.path === 'subject')).toBe(true);
  });

  it('DiagnosticReport with status and code passes required-element checks', () => {
    const result = validateResource({
      resourceType: 'DiagnosticReport',
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '58410-2' }] },
    });
    expect(result.valid).toBe(true);
  });

  it('MedicationRequest missing intent fails validation', () => {
    const result = validateResource({
      resourceType: 'MedicationRequest',
      status: 'active',
      subject: { reference: 'Patient/p1' },
      medicationCodeableConcept: { text: 'aspirin' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'intent' && e.severity === 'error')).toBe(true);
  });

  // ── FHIR-correct date / dateTime precision ──────────────────────────────────

  it('accepts a partial FHIR date with year-only precision (1985)', () => {
    expect(patterns.DATE.test('1985')).toBe(true);
    expect(patterns.DATE.test('1985-07')).toBe(true);
    expect(patterns.DATE.test('1985-07-22')).toBe(true);
    // Patient.birthDate = '1985' must now validate
    const result = validateResource({ resourceType: 'Patient', birthDate: '1985' });
    expect(result.errors.some((e) => e.path === 'birthDate')).toBe(false);
  });

  it('rejects an out-of-range month in a FHIR date', () => {
    expect(patterns.DATE.test('1985-13')).toBe(false);
  });

  it('rejects a dateTime that has a time but no timezone', () => {
    expect(patterns.DATETIME.test('2024-03-15T14:22:33')).toBe(false);
  });

  it('rejects a dateTime with a time but no seconds', () => {
    expect(patterns.DATETIME.test('2024-03-15T14:22Z')).toBe(false);
  });

  it('accepts a fully-specified dateTime with seconds and timezone', () => {
    expect(patterns.DATETIME.test('2024-03-15T14:22:33+05:30')).toBe(true);
    expect(patterns.DATETIME.test('2024-03-15T14:22:33Z')).toBe(true);
  });

  it('accepts a partial dateTime (date only, no time component)', () => {
    expect(patterns.DATETIME.test('2024')).toBe(true);
    expect(patterns.DATETIME.test('2024-03-15')).toBe(true);
  });

  // ── KNOWN_RESOURCE_TYPES covers every type that has a dedicated validator ────

  it('recognizes every resourceType that has a dedicated validator (no unknown-type warning)', () => {
    const typesWithValidators = [
      'Patient',
      'Medication',
      'Practitioner',
      'DocumentReference',
      'CarePlan',
      'CareTeam',
      'Immunization',
      'Specimen',
    ];
    for (const resourceType of typesWithValidators) {
      const result = validateResource({ resourceType });
      const unknownWarnings = result.errors.filter(
        (e) => e.path === 'resourceType' && /Unknown resourceType/.test(e.message),
      );
      expect(unknownWarnings, `${resourceType} should be a known resourceType`).toHaveLength(0);
    }
  });
});
