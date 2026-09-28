/**
 * Minimal FHIR R4 structure model for CSV/Excel import mappings.
 *
 * Chỉ mô tả các element mà mapping được phép ghi: đủ để (1) validate path với
 * thông báo lỗi chính xác, (2) biết element nào lặp (array) để dựng đúng cấu
 * trúc lồng nhau, (3) ép kiểu primitive (decimal → number, date, code...).
 * Element không có trong model bị từ chối ở parse time thay vì sinh FHIR sai.
 */

import type { FhirPathSegment } from '@fhirbridge/types';

/** FHIR primitive kinds the importer knows how to coerce. */
export type PrimitiveKind =
  'string' | 'code' | 'uri' | 'decimal' | 'integer' | 'boolean' | 'date' | 'dateTime';

const PRIMITIVES = new Set<string>([
  'string',
  'code',
  'uri',
  'decimal',
  'integer',
  'boolean',
  'date',
  'dateTime',
]);

/** Element table: name → type ("Type" or "Type[]" when repeating). */
type ElementTable = Readonly<Record<string, string>>;

/** Complex datatypes + backbone elements (inline, named here for reuse). */
const DATATYPES: Readonly<Record<string, ElementTable>> = {
  Coding: { system: 'uri', version: 'string', code: 'code', display: 'string' },
  CodeableConcept: { coding: 'Coding[]', text: 'string' },
  Identifier: {
    use: 'code',
    type: 'CodeableConcept',
    system: 'uri',
    value: 'string',
    period: 'Period',
  },
  HumanName: {
    use: 'code',
    text: 'string',
    family: 'string',
    given: 'string[]',
    prefix: 'string[]',
    suffix: 'string[]',
    period: 'Period',
  },
  ContactPoint: {
    system: 'code',
    value: 'string',
    use: 'code',
    rank: 'integer',
    period: 'Period',
  },
  Address: {
    use: 'code',
    type: 'code',
    text: 'string',
    line: 'string[]',
    city: 'string',
    district: 'string',
    state: 'string',
    postalCode: 'string',
    country: 'string',
    period: 'Period',
  },
  Period: { start: 'dateTime', end: 'dateTime' },
  Quantity: { value: 'decimal', comparator: 'code', unit: 'string', system: 'uri', code: 'code' },
  // Chỉ display: reference nội bộ do importer tự nối (subject/encounter)
  Reference: { display: 'string' },
  Annotation: { authorString: 'string', time: 'dateTime', text: 'string' },
  PatientContact: {
    relationship: 'CodeableConcept[]',
    name: 'HumanName',
    telecom: 'ContactPoint[]',
    address: 'Address',
    gender: 'code',
  },
  PatientCommunication: { language: 'CodeableConcept', preferred: 'boolean' },
  EncounterHospitalization: {
    admitSource: 'CodeableConcept',
    dischargeDisposition: 'CodeableConcept',
  },
  ObservationReferenceRange: { low: 'Quantity', high: 'Quantity', text: 'string' },
  AllergyIntoleranceReaction: {
    substance: 'CodeableConcept',
    manifestation: 'CodeableConcept[]',
    description: 'string',
    onset: 'dateTime',
    severity: 'code',
  },
};

/** Resource types the importer can produce, with their mappable elements. */
const RESOURCES: Readonly<Record<string, ElementTable>> = {
  Patient: {
    identifier: 'Identifier[]',
    active: 'boolean',
    name: 'HumanName[]',
    telecom: 'ContactPoint[]',
    gender: 'code',
    birthDate: 'date',
    deceasedBoolean: 'boolean',
    deceasedDateTime: 'dateTime',
    address: 'Address[]',
    maritalStatus: 'CodeableConcept',
    multipleBirthBoolean: 'boolean',
    multipleBirthInteger: 'integer',
    contact: 'PatientContact[]',
    communication: 'PatientCommunication[]',
    generalPractitioner: 'Reference[]',
    managingOrganization: 'Reference',
  },
  Encounter: {
    identifier: 'Identifier[]',
    status: 'code',
    class: 'Coding',
    type: 'CodeableConcept[]',
    serviceType: 'CodeableConcept',
    priority: 'CodeableConcept',
    period: 'Period',
    reasonCode: 'CodeableConcept[]',
    hospitalization: 'EncounterHospitalization',
    serviceProvider: 'Reference',
  },
  Condition: {
    identifier: 'Identifier[]',
    clinicalStatus: 'CodeableConcept',
    verificationStatus: 'CodeableConcept',
    category: 'CodeableConcept[]',
    severity: 'CodeableConcept',
    code: 'CodeableConcept',
    bodySite: 'CodeableConcept[]',
    onsetDateTime: 'dateTime',
    onsetString: 'string',
    abatementDateTime: 'dateTime',
    abatementString: 'string',
    recordedDate: 'dateTime',
    note: 'Annotation[]',
  },
  Observation: {
    identifier: 'Identifier[]',
    status: 'code',
    category: 'CodeableConcept[]',
    code: 'CodeableConcept',
    effectiveDateTime: 'dateTime',
    effectivePeriod: 'Period',
    valueQuantity: 'Quantity',
    valueCodeableConcept: 'CodeableConcept',
    valueString: 'string',
    valueBoolean: 'boolean',
    valueInteger: 'integer',
    valueDateTime: 'dateTime',
    dataAbsentReason: 'CodeableConcept',
    interpretation: 'CodeableConcept[]',
    note: 'Annotation[]',
    bodySite: 'CodeableConcept',
    method: 'CodeableConcept',
    referenceRange: 'ObservationReferenceRange[]',
  },
  Procedure: {
    identifier: 'Identifier[]',
    status: 'code',
    category: 'CodeableConcept',
    code: 'CodeableConcept',
    performedDateTime: 'dateTime',
    performedPeriod: 'Period',
    reasonCode: 'CodeableConcept[]',
    bodySite: 'CodeableConcept[]',
    outcome: 'CodeableConcept',
    note: 'Annotation[]',
  },
  AllergyIntolerance: {
    identifier: 'Identifier[]',
    clinicalStatus: 'CodeableConcept',
    verificationStatus: 'CodeableConcept',
    type: 'code',
    category: 'code[]',
    criticality: 'code',
    code: 'CodeableConcept',
    onsetDateTime: 'dateTime',
    recordedDate: 'dateTime',
    note: 'Annotation[]',
    reaction: 'AllergyIntoleranceReaction[]',
  },
};

/** Resource types supported by the CSV/Excel importer, in canonical output order. */
export const SUPPORTED_RESOURCE_TYPES: readonly string[] = Object.keys(RESOURCES);

/**
 * Elements the importer sets itself (references between resources) — mapping
 * them is rejected so the auto-wiring cannot be silently overridden.
 */
export const AUTO_REFERENCE_ELEMENTS: Readonly<Record<string, readonly string[]>> = {
  Encounter: ['subject'],
  Condition: ['subject', 'encounter'],
  Observation: ['subject', 'encounter'],
  Procedure: ['subject', 'encounter'],
  AllergyIntolerance: ['patient', 'encounter'],
};

/**
 * FHIR "required" code bindings: values outside the set are invalid FHIR, so
 * the transformer drops them (with a warning) instead of emitting bad codes.
 * Key = "<Type or Datatype>.<element>".
 */
export const REQUIRED_CODE_BINDINGS: Readonly<Record<string, readonly string[]>> = {
  'Patient.gender': ['male', 'female', 'other', 'unknown'],
  'PatientContact.gender': ['male', 'female', 'other', 'unknown'],
  'ContactPoint.system': ['phone', 'fax', 'email', 'pager', 'url', 'sms', 'other'],
  'ContactPoint.use': ['home', 'work', 'temp', 'old', 'mobile'],
  'Address.use': ['home', 'work', 'temp', 'old', 'billing'],
  'Address.type': ['postal', 'physical', 'both'],
  'HumanName.use': ['usual', 'official', 'temp', 'nickname', 'anonymous', 'old', 'maiden'],
  'Identifier.use': ['usual', 'official', 'temp', 'secondary', 'old'],
  'Quantity.comparator': ['<', '<=', '>=', '>'],
  'Encounter.status': [
    'planned',
    'arrived',
    'triaged',
    'in-progress',
    'onleave',
    'finished',
    'cancelled',
    'entered-in-error',
    'unknown',
  ],
  'Observation.status': [
    'registered',
    'preliminary',
    'final',
    'amended',
    'corrected',
    'cancelled',
    'entered-in-error',
    'unknown',
  ],
  'Procedure.status': [
    'preparation',
    'in-progress',
    'not-done',
    'on-hold',
    'stopped',
    'completed',
    'entered-in-error',
    'unknown',
  ],
  'AllergyIntolerance.type': ['allergy', 'intolerance'],
  'AllergyIntolerance.category': ['food', 'medication', 'environment', 'biologic'],
  'AllergyIntolerance.criticality': ['low', 'high', 'unable-to-assess'],
  'AllergyIntoleranceReaction.severity': ['mild', 'moderate', 'severe'],
};

/** Result of resolving a mapping path against the model. */
export interface ResolvedPath {
  /** Segments with explicit indices for every repeating element */
  segments: FhirPathSegment[];
  /** Leaf primitive kind */
  kind: PrimitiveKind;
  /** "<Owner>.<element>" of the leaf, used for binding lookups (e.g. "Patient.gender") */
  bindingKey: string;
}

/** Parse a type spec like "HumanName[]" into its parts. */
function parseTypeSpec(spec: string): { type: string; array: boolean } {
  return spec.endsWith('[]')
    ? { type: spec.slice(0, -2), array: true }
    : { type: spec, array: false };
}

const SEGMENT_RE = /^([A-Za-z][A-Za-z0-9]*)(?:\[(\d*)\])?$/;

/**
 * Resolve a dotted path (below the resource) against the model.
 * `[]` và `[n]` đều hợp lệ trên element lặp; element lặp không ghi index được
 * hiểu là `[0]` (vd "name.family" ≡ "name[0].family").
 *
 * @returns ResolvedPath, or a human-readable error string
 */
export function resolveFieldPath(resourceType: string, path: string): ResolvedPath | string {
  const table = RESOURCES[resourceType];
  if (!table) {
    return `unknown resource type "${resourceType}" (supported: ${SUPPORTED_RESOURCE_TYPES.join(', ')})`;
  }

  const rawSegments = path.split('.');
  const segments: FhirPathSegment[] = [];
  let currentTable: ElementTable = table;
  let owner = resourceType;

  for (let i = 0; i < rawSegments.length; i++) {
    const raw = rawSegments[i]!;
    const match = raw.match(SEGMENT_RE);
    if (!match) {
      return `invalid path segment "${raw}" (expected an element name, optionally followed by [] or [n])`;
    }
    const name = match[1]!;
    const indexText = match[2];

    if (i === 0) {
      if (name === 'id' || name === 'resourceType' || name === 'meta') {
        return `"${name}" is generated by the importer and cannot be mapped (use "patientId" to identify patients)`;
      }
      if (AUTO_REFERENCE_ELEMENTS[resourceType]?.includes(name)) {
        return `"${resourceType}.${name}" is set automatically (it references the row's ${name === 'encounter' ? 'Encounter' : 'Patient'}) and cannot be mapped`;
      }
    }

    const spec = currentTable[name];
    if (!spec) {
      return `"${name}" is not a supported element of ${owner} (supported: ${Object.keys(currentTable).join(', ')})`;
    }
    const { type, array } = parseTypeSpec(spec);

    if (indexText !== undefined && !array) {
      return `"${name}" is not a repeating element of ${owner}; remove "[${indexText}]"`;
    }
    const index = array ? (indexText ? Number(indexText) : 0) : undefined;
    if (index !== undefined && index > 9) {
      return `index [${index}] on "${name}" is too large (max 9)`;
    }
    segments.push(index === undefined ? { name } : { name, index });

    const isLast = i === rawSegments.length - 1;
    if (PRIMITIVES.has(type)) {
      if (!isLast) {
        return `"${name}" is a ${type} value and has no child elements (remove ".${rawSegments.slice(i + 1).join('.')}")`;
      }
      return { segments, kind: type as PrimitiveKind, bindingKey: `${owner}.${name}` };
    }

    const childTable = DATATYPES[type];
    if (!childTable) {
      return `"${name}" has unsupported type ${type}`;
    }
    if (isLast) {
      return `"${name}" is a ${type}; map one of its elements instead (${Object.keys(childTable).join(', ')})`;
    }
    currentTable = childTable;
    owner = type;
  }

  // Unreachable: loop always returns on the last segment.
  return 'empty path';
}

/** Render normalized segments back to a path string, e.g. "name[0].given[0]". */
export function formatSegments(segments: readonly FhirPathSegment[]): string {
  return segments.map((s) => (s.index === undefined ? s.name : `${s.name}[${s.index}]`)).join('.');
}
