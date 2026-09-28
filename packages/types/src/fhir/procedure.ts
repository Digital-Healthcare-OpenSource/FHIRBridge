/**
 * FHIR R4 Procedure resource type.
 * An action that was or is being performed on or for a patient.
 */

import type {
  DomainResource,
  Identifier,
  CodeableConcept,
  Reference,
  Period,
} from './base-resource.js';

/** Procedure status values (FHIR R4) */
export type ProcedureStatus =
  | 'preparation'
  | 'in-progress'
  | 'not-done'
  | 'on-hold'
  | 'stopped'
  | 'completed'
  | 'entered-in-error'
  | 'unknown';

/** Performer of the procedure */
export interface ProcedurePerformer {
  function?: CodeableConcept;
  actor: Reference;
  onBehalfOf?: Reference;
}

/** Focal device used in the procedure */
export interface ProcedureFocalDevice {
  action?: CodeableConcept;
  manipulated: Reference;
}

/**
 * FHIR R4 Procedure resource.
 * Required: status, subject.
 */
export interface Procedure extends DomainResource {
  readonly resourceType: 'Procedure';
  identifier?: Identifier[];
  instantiatesCanonical?: string[];
  instantiatesUri?: string[];
  basedOn?: Reference[];
  partOf?: Reference[];
  /** Required: current state of the procedure */
  status: ProcedureStatus;
  statusReason?: CodeableConcept;
  category?: CodeableConcept;
  /** Identification of the procedure */
  code?: CodeableConcept;
  /** Required: who the procedure was performed on */
  subject: Reference;
  encounter?: Reference;
  performedDateTime?: string;
  /** Time period during which the procedure was performed */
  performedPeriod?: Period;
  performedString?: string;
  performedAge?: { value: number; unit: string };
  performedRange?: {
    low?: { value: number; unit: string };
    high?: { value: number; unit: string };
  };
  recorder?: Reference;
  asserter?: Reference;
  performer?: ProcedurePerformer[];
  location?: Reference;
  reasonCode?: CodeableConcept[];
  reasonReference?: Reference[];
  bodySite?: CodeableConcept[];
  outcome?: CodeableConcept;
  report?: Reference[];
  complication?: CodeableConcept[];
  complicationDetail?: Reference[];
  followUp?: CodeableConcept[];
  note?: Array<{ text: string }>;
  focalDevice?: ProcedureFocalDevice[];
  usedReference?: Reference[];
  usedCode?: CodeableConcept[];
}
