/**
 * FHIR R4 AllergyIntolerance resource type.
 * Risk of harmful or undesirable physiological response to a substance.
 */

import type {
  DomainResource,
  Identifier,
  CodeableConcept,
  Reference,
  Period,
} from './base-resource.js';

/** AllergyIntolerance clinical status codes */
export type AllergyIntoleranceClinicalStatus = 'active' | 'inactive' | 'resolved';

/** AllergyIntolerance verification status codes */
export type AllergyIntoleranceVerificationStatus =
  'unconfirmed' | 'presumed' | 'confirmed' | 'refuted' | 'entered-in-error';

/** Type of the allergy/intolerance */
export type AllergyIntoleranceType = 'allergy' | 'intolerance';

/** Category of the identified substance */
export type AllergyIntoleranceCategory = 'food' | 'medication' | 'environment' | 'biologic';

/** Criticality of the reaction risk */
export type AllergyIntoleranceCriticality = 'low' | 'high' | 'unable-to-assess';

/** Adverse reaction event details */
export interface AllergyIntoleranceReaction {
  substance?: CodeableConcept;
  /** Required: clinical manifestation of the reaction */
  manifestation: CodeableConcept[];
  description?: string;
  onset?: string;
  severity?: 'mild' | 'moderate' | 'severe';
  exposureRoute?: CodeableConcept;
  note?: Array<{ text: string }>;
}

/**
 * FHIR R4 AllergyIntolerance resource.
 * Required: patient.
 */
export interface AllergyIntolerance extends DomainResource {
  readonly resourceType: 'AllergyIntolerance';
  identifier?: Identifier[];
  /** Clinical status — active, inactive, or resolved */
  clinicalStatus?: CodeableConcept;
  /** Verification status of the allergy/intolerance */
  verificationStatus?: CodeableConcept;
  /** Whether this is an allergy or intolerance */
  type?: AllergyIntoleranceType;
  /** Category of the substance involved */
  category?: AllergyIntoleranceCategory[];
  /** Estimate of potential clinical harm */
  criticality?: AllergyIntoleranceCriticality;
  /** Identified substance */
  code?: CodeableConcept;
  /** Required: patient who has the allergy/intolerance */
  patient: Reference;
  encounter?: Reference;
  onsetDateTime?: string;
  onsetAge?: { value: number; unit: string };
  onsetPeriod?: Period;
  onsetRange?: { low?: { value: number; unit: string }; high?: { value: number; unit: string } };
  onsetString?: string;
  recordedDate?: string;
  recorder?: Reference;
  asserter?: Reference;
  lastOccurrence?: string;
  note?: Array<{ text: string }>;
  reaction?: AllergyIntoleranceReaction[];
}
