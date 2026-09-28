/**
 * Tests for the FHIR R4 Patient validator.
 * Uses realistic R4 Patient shapes (no PHI).
 */

import { describe, it, expect } from 'vitest';
import { validatePatient } from '../patient-validator.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const validPatient = {
  resourceType: 'Patient',
  id: 'patient-001',
  name: [{ use: 'official', family: 'Doe', given: ['Jane'] }],
  gender: 'female',
  birthDate: '1985-07-22',
  address: [
    { use: 'home', line: ['123 Main St'], city: 'Boston', state: 'MA', postalCode: '02101' },
  ],
  telecom: [{ system: 'phone', value: '555-000-0000', use: 'home' }],
  identifier: [{ system: 'http://example.hospital.org/patients', value: 'P001' }],
};

// ── Valid patient tests ───────────────────────────────────────────────────────

describe('validatePatient', () => {
  it('returns valid for a complete Patient resource', () => {
    const result = validatePatient(validPatient);
    expect(result.valid).toBe(true);
    expect(result.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
  });

  it('returns valid with minimal required fields (name.family + resourceType)', () => {
    const minimal = {
      resourceType: 'Patient',
      name: [{ family: 'Smith' }],
      gender: 'male',
      birthDate: '1990-01-01',
    };
    const result = validatePatient(minimal);
    expect(result.valid).toBe(true);
  });

  // ── resourceType checks ───────────────────────────────────────────────────

  it('returns error if resourceType is not "Patient"', () => {
    const result = validatePatient({ ...validPatient, resourceType: 'Encounter' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'resourceType' && e.severity === 'error')).toBe(
      true,
    );
  });

  // ── Name validation ───────────────────────────────────────────────────────

  it('returns error when name is missing', () => {
    const { name, ...rest } = validPatient;
    const result = validatePatient(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'name')).toBe(true);
  });

  it('returns error when name array is empty', () => {
    const result = validatePatient({ ...validPatient, name: [] });
    expect(result.valid).toBe(false);
  });

  it('returns error when no name has a family element', () => {
    const result = validatePatient({ ...validPatient, name: [{ given: ['John'] }] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'name[0].family')).toBe(true);
  });

  it('accepts name with only family (no given)', () => {
    const result = validatePatient({ ...validPatient, name: [{ family: 'Solo' }] });
    expect(
      result.errors.filter((e) => e.path.startsWith('name') && e.severity === 'error'),
    ).toHaveLength(0);
  });

  // ── Gender validation ─────────────────────────────────────────────────────

  it('returns warning when gender is missing', () => {
    const { gender, ...rest } = validPatient;
    const result = validatePatient(rest);
    const warnings = result.errors.filter((e) => e.path === 'gender' && e.severity === 'warning');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('returns error for invalid gender value', () => {
    const result = validatePatient({ ...validPatient, gender: 'not-a-gender' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'gender' && e.severity === 'error')).toBe(true);
  });

  it('accepts all valid gender values', () => {
    for (const gender of ['male', 'female', 'other', 'unknown']) {
      const result = validatePatient({ ...validPatient, gender });
      expect(
        result.errors.filter((e) => e.path === 'gender' && e.severity === 'error'),
      ).toHaveLength(0);
    }
  });

  // ── birthDate validation ──────────────────────────────────────────────────

  it('returns warning when birthDate is missing', () => {
    const { birthDate, ...rest } = validPatient;
    const result = validatePatient(rest);
    const warnings = result.errors.filter(
      (e) => e.path === 'birthDate' && e.severity === 'warning',
    );
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('returns error for invalid birthDate format', () => {
    const result = validatePatient({ ...validPatient, birthDate: '22/07/1985' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'birthDate')).toBe(true);
  });

  it('accepts YYYY-MM-DD birthDate', () => {
    const result = validatePatient({ ...validPatient, birthDate: '2000-12-31' });
    expect(
      result.errors.filter((e) => e.path === 'birthDate' && e.severity === 'error'),
    ).toHaveLength(0);
  });

  // ── Identifier validation ─────────────────────────────────────────────────

  it('returns error when identifier is not an array', () => {
    const result = validatePatient({ ...validPatient, identifier: 'not-an-array' });
    expect(result.valid).toBe(false);
  });

  it('accepts patient without identifier (optional)', () => {
    const { identifier, ...rest } = validPatient;
    const result = validatePatient(rest);
    expect(
      result.errors.filter((e) => e.path.startsWith('identifier') && e.severity === 'error'),
    ).toHaveLength(0);
  });
});
