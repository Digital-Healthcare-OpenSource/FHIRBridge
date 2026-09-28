/**
 * Tests for code-systems: system URI constants and KNOWN_SYSTEMS set.
 */

import { describe, it, expect } from 'vitest';
import {
  LOINC_SYSTEM,
  SNOMED_SYSTEM,
  RXNORM_SYSTEM,
  ICD10_SYSTEM,
  ICD10_CM_SYSTEM,
  ICD10_PCS_SYSTEM,
  CPT_SYSTEM,
  HL7_ACT_CODE_SYSTEM,
  CONDITION_CLINICAL_SYSTEM,
  CONDITION_VER_STATUS_SYSTEM,
  CONDITION_CATEGORY_SYSTEM,
  V3_NULL_FLAVOR_SYSTEM,
  ALLERGY_CLINICAL_SYSTEM,
  ALLERGY_VER_STATUS_SYSTEM,
  OBSERVATION_CATEGORY_SYSTEM,
  KNOWN_SYSTEMS,
} from '../code-systems.js';

describe('code system URI constants', () => {
  it('LOINC_SYSTEM equals canonical LOINC URI', () => {
    expect(LOINC_SYSTEM).toBe('http://loinc.org');
  });

  it('SNOMED_SYSTEM equals canonical SNOMED CT URI', () => {
    expect(SNOMED_SYSTEM).toBe('http://snomed.info/sct');
  });

  it('RXNORM_SYSTEM equals canonical RxNorm URI', () => {
    expect(RXNORM_SYSTEM).toBe('http://www.nlm.nih.gov/research/umls/rxnorm');
  });

  it('ICD10_CM_SYSTEM equals correct HL7 ICD-10-CM URI', () => {
    expect(ICD10_CM_SYSTEM).toBe('http://hl7.org/fhir/sid/icd-10-cm');
  });

  it('ICD10_SYSTEM equals the HL7 URI for WHO ICD-10 (not ICD-10-CM)', () => {
    expect(ICD10_SYSTEM).toBe('http://hl7.org/fhir/sid/icd-10');
    expect(ICD10_SYSTEM).not.toBe(ICD10_CM_SYSTEM);
  });

  it('CONDITION_CATEGORY_SYSTEM and V3_NULL_FLAVOR_SYSTEM equal the HL7 terminology URIs', () => {
    expect(CONDITION_CATEGORY_SYSTEM).toBe(
      'http://terminology.hl7.org/CodeSystem/condition-category',
    );
    expect(V3_NULL_FLAVOR_SYSTEM).toBe('http://terminology.hl7.org/CodeSystem/v3-NullFlavor');
  });

  it('ICD10_PCS_SYSTEM equals correct CMS URI', () => {
    expect(ICD10_PCS_SYSTEM).toBe('http://www.cms.gov/Medicare/Coding/ICD10');
  });

  it('CPT_SYSTEM equals correct AMA URI', () => {
    expect(CPT_SYSTEM).toBe('http://www.ama-assn.org/go/cpt');
  });

  it('all constants are non-empty strings', () => {
    const systems = [
      LOINC_SYSTEM,
      SNOMED_SYSTEM,
      RXNORM_SYSTEM,
      ICD10_CM_SYSTEM,
      ICD10_PCS_SYSTEM,
      CPT_SYSTEM,
      HL7_ACT_CODE_SYSTEM,
      CONDITION_CLINICAL_SYSTEM,
      CONDITION_VER_STATUS_SYSTEM,
      ALLERGY_CLINICAL_SYSTEM,
      ALLERGY_VER_STATUS_SYSTEM,
      OBSERVATION_CATEGORY_SYSTEM,
    ];
    for (const sys of systems) {
      expect(typeof sys).toBe('string');
      expect(sys.length).toBeGreaterThan(0);
    }
  });
});

describe('KNOWN_SYSTEMS', () => {
  it('is a Set', () => {
    expect(KNOWN_SYSTEMS).toBeInstanceOf(Set);
  });

  it('contains LOINC system', () => {
    expect(KNOWN_SYSTEMS.has(LOINC_SYSTEM)).toBe(true);
  });

  it('contains SNOMED system', () => {
    expect(KNOWN_SYSTEMS.has(SNOMED_SYSTEM)).toBe(true);
  });

  it('contains RxNorm system', () => {
    expect(KNOWN_SYSTEMS.has(RXNORM_SYSTEM)).toBe(true);
  });

  it('contains ICD-10-CM system', () => {
    expect(KNOWN_SYSTEMS.has(ICD10_CM_SYSTEM)).toBe(true);
  });

  it('contains WHO ICD-10 system (VN/KR/JP example mappings use it)', () => {
    expect(KNOWN_SYSTEMS.has('http://hl7.org/fhir/sid/icd-10')).toBe(true);
  });

  it('contains all defined system constants', () => {
    const allSystems = [
      LOINC_SYSTEM,
      SNOMED_SYSTEM,
      RXNORM_SYSTEM,
      ICD10_SYSTEM,
      ICD10_CM_SYSTEM,
      ICD10_PCS_SYSTEM,
      CPT_SYSTEM,
      HL7_ACT_CODE_SYSTEM,
      CONDITION_CLINICAL_SYSTEM,
      CONDITION_VER_STATUS_SYSTEM,
      CONDITION_CATEGORY_SYSTEM,
      V3_NULL_FLAVOR_SYSTEM,
      ALLERGY_CLINICAL_SYSTEM,
      ALLERGY_VER_STATUS_SYSTEM,
      OBSERVATION_CATEGORY_SYSTEM,
    ];
    for (const sys of allSystems) {
      expect(KNOWN_SYSTEMS.has(sys)).toBe(true);
    }
  });

  it('does not contain unknown system URIs', () => {
    expect(KNOWN_SYSTEMS.has('http://unknown.org')).toBe(false);
    expect(KNOWN_SYSTEMS.has('')).toBe(false);
  });
});
