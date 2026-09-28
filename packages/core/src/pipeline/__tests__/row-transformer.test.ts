/**
 * Tests for RowTransformer — row → FHIR resources with the canonical mapping.
 */

import { describe, it, expect } from 'vitest';
import type { Resource } from '@fhirbridge/types';

import { parseMappingConfig } from '../../connectors/mapping/mapping-config-parser.js';
import { containsRrn } from '../../security/rrn-detector.js';
import { validateCodeableConcept } from '../../validators/coding-validator.js';
import { validatePatient } from '../../validators/patient-validator.js';
import { validateReferenceInBundle } from '../../validators/reference-validator.js';
import { patterns, validateResource } from '../../validators/resource-validator.js';
import {
  RowTransformer,
  deterministicUuid,
  formatImportIssue,
  transformRows,
  type TabularRow,
} from '../row-transformer.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const HOSPITAL_MAPPING = {
  patientId: { column: 'MRN', system: 'urn:oid:2.16.840.1.113883.19.5' },
  timezone: '+07:00',
  fields: {
    'Patient.identifier[].value': 'MRN',
    'Patient.name.family': 'LAST',
    'Patient.name.given': 'FIRST',
    'Patient.gender': {
      column: 'SEX',
      transform: 'lowercase',
      valueMap: { M: 'male', F: 'female' },
    },
    'Patient.birthDate': { column: 'DOB', transform: 'date', format: 'DD/MM/YYYY' },
    'Patient.telecom[].system': { literal: 'phone' },
    'Patient.telecom[].value': 'PHONE',
    'Patient.address.country': { literal: 'VN' },
    'Patient.address.city': 'CITY',
    'Encounter.period.start': {
      column: 'VISIT',
      transform: 'datetime',
      format: 'DD/MM/YYYY HH:mm',
    },
    'Encounter.class.code': { column: 'KIND', valueMap: { NgoaiTru: 'AMB', NoiTru: 'IMP' } },
    'Condition.code.coding[].system': { literal: 'http://hl7.org/fhir/sid/icd-10' },
    'Condition.code.coding[].code': 'ICD',
    'Condition.code.text': 'DX',
    'Observation.code.coding[].system': { literal: 'http://loinc.org' },
    'Observation.code.coding[].code': 'LOINC',
    'Observation.effectiveDateTime': {
      column: 'VISIT',
      transform: 'datetime',
      format: 'DD/MM/YYYY HH:mm',
    },
    'Observation.valueQuantity.value': 'VALUE',
    'Observation.valueQuantity.unit': 'UNIT',
  },
  resourceTypes: ['Patient', 'Encounter', 'Condition', 'Observation'],
};

const BASE_ROW = {
  MRN: 'MRN-1',
  LAST: 'Nguyen',
  FIRST: 'Van A',
  SEX: 'M',
  DOB: '15/03/1985',
  PHONE: '555-0101',
  CITY: 'Ha Noi',
  VISIT: '04/03/2024 08:30',
  KIND: 'NgoaiTru',
  ICD: 'I10',
  DX: 'Hypertension',
  LOINC: '8480-6',
  VALUE: '142',
  UNIT: 'mm[Hg]',
};

const row = (values: Record<string, unknown>, rowNumber = 2): TabularRow => ({ rowNumber, values });

function run(mappingInput: unknown, rows: Record<string, unknown>[], options = {}) {
  const mapping = parseMappingConfig(mappingInput);
  const result = transformRows(
    mapping,
    rows.map((values, i) => row(values, i + 2)),
    options,
  );
  const resources = (result.bundle.entry ?? []).map((e) => e.resource as unknown as Json);
  const byType = (type: string) => resources.filter((r) => r['resourceType'] === type);
  return { ...result, resources, byType };
}

/** Every resource passes the repo's validators; codings/references are well-formed. */
function expectAllValid(result: ReturnType<typeof run>) {
  for (const entry of result.bundle.entry ?? []) {
    const r = entry.resource as unknown as Json;
    const v = r['resourceType'] === 'Patient' ? validatePatient(r) : validateResource(r);
    expect(
      v.errors.filter((e) => e.severity === 'error'),
      r['resourceType'],
    ).toEqual([]);
    expect(entry.fullUrl).toBe(`urn:uuid:${r['id']}`);
    for (const key of ['code', 'clinicalStatus']) {
      if (r[key]) {
        const cc = validateCodeableConcept(r[key], key);
        expect(cc.errors, `${r['resourceType']}.${key}`).toEqual([]);
      }
    }
    for (const key of ['subject', 'encounter', 'patient']) {
      if (r[key]?.reference) {
        expect(validateReferenceInBundle(r[key], result.bundle, key).errors).toEqual([]);
      }
    }
  }
}

describe('RowTransformer — structures, transforms, references', () => {
  it('builds one resource per type with correct nested FHIR structures', () => {
    const result = run(HOSPITAL_MAPPING, [BASE_ROW]);
    expect(result.resources.map((r) => r['resourceType'])).toEqual([
      'Patient',
      'Encounter',
      'Condition',
      'Observation',
    ]);
    const [patient] = result.byType('Patient');
    expect(patient).toMatchObject({
      identifier: [{ system: 'urn:oid:2.16.840.1.113883.19.5', value: 'MRN-1' }],
      name: [{ family: 'Nguyen', given: ['Van A'] }],
      gender: 'male',
      birthDate: '1985-03-15',
      telecom: [{ system: 'phone', value: '555-0101' }],
      address: [{ city: 'Ha Noi', country: 'VN' }],
    });
    const [obs] = result.byType('Observation');
    expect(obs!['valueQuantity']).toEqual({ value: 142, unit: 'mm[Hg]' });
    expect(typeof obs!['valueQuantity'].value).toBe('number');
    expect(obs!['code']).toEqual({ coding: [{ system: 'http://loinc.org', code: '8480-6' }] });
    expect(obs!['effectiveDateTime']).toBe('2024-03-04T08:30:00+07:00');
    expect(result.issues).toEqual([]);
    expectAllValid(result);
  });

  it('wires subject/encounter references and required defaults', () => {
    const result = run(HOSPITAL_MAPPING, [BASE_ROW]);
    const [patient] = result.byType('Patient');
    const [enc] = result.byType('Encounter');
    const [cond] = result.byType('Condition');
    const [obs] = result.byType('Observation');
    const patientRef = { reference: `urn:uuid:${patient!['id']}` };
    const encRef = { reference: `urn:uuid:${enc!['id']}` };

    expect(enc).toMatchObject({
      status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      period: { start: '2024-03-04T08:30:00+07:00' },
      subject: patientRef,
    });
    expect(enc!['encounter']).toBeUndefined();
    expect(cond).toMatchObject({
      clinicalStatus: {
        coding: [
          { system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' },
        ],
      },
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/condition-category',
              code: 'encounter-diagnosis',
            },
          ],
        },
      ],
      code: {
        coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'I10' }],
        text: 'Hypertension',
      },
      subject: patientRef,
      encounter: encRef,
    });
    expect(obs).toMatchObject({ status: 'final', subject: patientRef, encounter: encRef });
  });

  it('WHO ICD-10 codings raise no "unrecognized terminology" warning', () => {
    const [cond] = run(HOSPITAL_MAPPING, [BASE_ROW]).byType('Condition');
    expect(validateCodeableConcept(cond!['code']).errors).toEqual([]);
  });

  it('deduplicates Patients across rows by patientId', () => {
    const result = run(HOSPITAL_MAPPING, [
      BASE_ROW,
      { ...BASE_ROW, VISIT: '01/04/2024 09:00', VALUE: '130' },
      { ...BASE_ROW, MRN: 'MRN-2', LAST: 'Tran', FIRST: 'Thi B', SEX: 'F' },
    ]);
    const patients = result.byType('Patient');
    expect(patients).toHaveLength(2);
    expect(result.byType('Encounter')).toHaveLength(3);
    const subjects = result.byType('Encounter').map((e) => e['subject'].reference);
    expect(subjects[0]).toBe(subjects[1]);
    expect(subjects[0]).toBe(`urn:uuid:${patients[0]!['id']}`);
    expect(subjects[2]).toBe(`urn:uuid:${patients[1]!['id']}`);
    // Condition in row 3 → row 3's Encounter, not row 2's
    const conds = result.byType('Condition');
    const encs = result.byType('Encounter');
    conds.forEach((c, i) => expect(c['encounter'].reference).toBe(`urn:uuid:${encs[i]!['id']}`));
    expect(result.stats).toMatchObject({
      rowsRead: 3,
      resourcesByType: { Patient: 2, Encounter: 3, Condition: 3, Observation: 3 },
    });
    expectAllValid(result);
  });

  it('creates non-Patient resources only when one of their own columns has a value', () => {
    const result = run(HOSPITAL_MAPPING, [
      { ...BASE_ROW, ICD: '', DX: '', LOINC: '', VALUE: '', UNIT: '' },
    ]);
    // VISIT is shared (Encounter + Observation) → alone it does not create an Observation
    expect(result.resources.map((r) => r['resourceType'])).toEqual(['Patient', 'Encounter']);
    expect(result.issues).toEqual([]);
  });

  it('drops literal-only elements (no phone → no telecom, no city → no address)', () => {
    const [patient] = run(HOSPITAL_MAPPING, [{ ...BASE_ROW, PHONE: '', CITY: '' }]).byType(
      'Patient',
    );
    expect(patient!['telecom']).toBeUndefined();
    expect(patient!['address']).toBeUndefined();
  });

  it('keeps a coding system literal only with its code; text alone is fine', () => {
    const [cond] = run(HOSPITAL_MAPPING, [{ ...BASE_ROW, ICD: '' }]).byType('Condition');
    expect(cond!['code']).toEqual({ text: 'Hypertension' });
  });

  it('Condition without an Encounter in the row has no encounter/category', () => {
    const result = run(HOSPITAL_MAPPING, [{ ...BASE_ROW, VISIT: '', KIND: '' }]);
    expect(result.byType('Encounter')).toHaveLength(0);
    const [cond] = result.byType('Condition');
    expect(cond!['encounter']).toBeUndefined();
    expect(cond!['category']).toBeUndefined();
    expectAllValid(result);
  });

  it('Encounter without a class code gets v3-NullFlavor UNK (class is 1..1)', () => {
    const [enc] = run(HOSPITAL_MAPPING, [{ ...BASE_ROW, KIND: '' }]).byType('Encounter');
    expect(enc!['class']).toEqual({
      system: 'http://terminology.hl7.org/CodeSystem/v3-NullFlavor',
      code: 'UNK',
      display: 'unknown',
    });
  });

  it('warns once when an Encounter.class code is not a v3-ActCode encounter code', () => {
    const result = run(HOSPITAL_MAPPING, [
      { ...BASE_ROW, KIND: 'CapCuu' },
      { ...BASE_ROW, KIND: 'CapCuu' },
    ]);
    const warnings = result.issues.filter((i) => /v3-ActCode/.test(i.message));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).not.toContain('CapCuu');
  });

  it('applies defaults for Procedure and AllergyIntolerance (patient reference)', () => {
    const result = run(
      {
        patientId: 'MRN',
        fields: {
          'Patient.name.family': 'LAST',
          'Procedure.code.text': 'PROC',
          'AllergyIntolerance.code.text': 'ALLERGY',
          'AllergyIntolerance.category': { column: 'ACAT', transform: 'lowercase' },
        },
      },
      [{ MRN: 'A1', LAST: 'Doe', PROC: 'Appendectomy', ALLERGY: 'Penicillin', ACAT: 'Medication' }],
    );
    const [patient] = result.byType('Patient');
    const [proc] = result.byType('Procedure');
    const [allergy] = result.byType('AllergyIntolerance');
    expect(proc).toMatchObject({
      status: 'completed',
      subject: { reference: `urn:uuid:${patient!['id']}` },
    });
    expect(allergy).toMatchObject({
      clinicalStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
            code: 'active',
          },
        ],
      },
      category: ['medication'],
      patient: { reference: `urn:uuid:${patient!['id']}` },
    });
    expect(allergy!['subject']).toBeUndefined();
    expectAllValid(result);
  });
});

describe('RowTransformer — value transforms', () => {
  const tx = (spec: unknown, value: unknown, path = 'Patient.name.text', extra = {}) => {
    const result = run({ fields: { 'Patient.name.family': 'LAST', [path]: spec }, ...extra }, [
      { LAST: 'Doe', V: value },
    ]);
    return { patient: result.byType('Patient')[0]!, issues: result.issues };
  };

  it('lowercase / uppercase / trim', () => {
    expect(tx({ column: 'V', transform: 'lowercase' }, 'ABC').patient['name'][0].text).toBe('abc');
    expect(tx({ column: 'V', transform: 'uppercase' }, 'abc').patient['name'][0].text).toBe('ABC');
    expect(tx({ column: 'V', transform: 'trim' }, '  a b  ').patient['name'][0].text).toBe('a b');
  });

  it('valueMap: exact, then case-insensitive, unmapped values pass through', () => {
    const spec = { column: 'V', valueMap: { Nam: 'male', Nu: 'female' } };
    expect(tx(spec, 'Nam', 'Patient.gender').patient['gender']).toBe('male');
    expect(tx(spec, 'NU', 'Patient.gender').patient['gender']).toBe('female');
    expect(
      tx({ ...spec, transform: 'lowercase' }, 'Other', 'Patient.gender').patient['gender'],
    ).toBe('other');
  });

  it('drops invalid required-binding codes with a warning (no cell value echoed)', () => {
    const { patient, issues } = tx({ column: 'V' }, 'Xyz', 'Patient.gender');
    expect(patient['gender']).toBeUndefined();
    expect(issues).toHaveLength(1);
    expect(formatImportIssue(issues[0]!)).toMatch(
      /^row 2, field "Patient.gender", column "V": value is not a valid Patient.gender code \(allowed: male, female, other, unknown/,
    );
    expect(formatImportIssue(issues[0]!)).not.toContain('Xyz');
  });

  it('number transform and automatic decimal/integer/boolean coercion', () => {
    const result = run(
      {
        patientId: 'ID',
        fields: {
          'Patient.name.family': 'L',
          'Patient.multipleBirthInteger': 'TWIN',
          'Patient.active': 'ACTIVE',
          'Observation.code.text': 'T',
          'Observation.valueQuantity.value': { column: 'V', transform: 'number' },
        },
      },
      [{ ID: '1', L: 'Doe', TWIN: '2', ACTIVE: 'yes', T: 'x', V: ' 7.10 ' }],
    );
    const [patient] = result.byType('Patient');
    expect(patient!['multipleBirthInteger']).toBe(2);
    expect(patient!['active']).toBe(true);
    expect(result.byType('Observation')[0]!['valueQuantity'].value).toBe(7.1);
  });

  it('non-numeric values are omitted with a warning', () => {
    const result = run(
      {
        patientId: 'ID',
        fields: {
          'Patient.name.family': 'L',
          'Observation.code.text': 'T',
          'Observation.valueQuantity.value': 'V',
        },
      },
      [{ ID: '1', L: 'Doe', T: 'x', V: 'positive' }],
    );
    expect(result.byType('Observation')[0]!['valueQuantity']).toBeUndefined();
    expect(result.issues[0]!.message).toBe('value is not a number — field omitted');
  });

  it('date transform with formats and auto-detection for date elements', () => {
    expect(
      tx({ column: 'V', transform: 'date', format: 'YYYYMMDD' }, '19850315', 'Patient.birthDate')
        .patient['birthDate'],
    ).toBe('1985-03-15');
    expect(
      tx(
        { column: 'V', transform: 'date', format: 'YYYY/MM/DD' },
        '1985/03/15',
        'Patient.birthDate',
      ).patient['birthDate'],
    ).toBe('1985-03-15');
    // no transform: date elements are auto-normalized
    expect(tx('V', '15/03/1985', 'Patient.birthDate').patient['birthDate']).toBe('1985-03-15');
    const bad = tx(
      { column: 'V', transform: 'date', format: 'DD/MM/YYYY' },
      '31/02/1985',
      'Patient.birthDate',
    );
    expect(bad.patient['birthDate']).toBeUndefined();
    expect(bad.issues[0]!.message).toBe('day out of range — field omitted');
  });

  it('datetime → FHIR dateTime using the mapping timezone or the value offset', () => {
    const spec = { column: 'V', transform: 'datetime', format: 'YYYY-MM-DD HH:mm' };
    expect(
      tx(spec, '2024-03-04 09:30', 'Patient.deceasedDateTime', { timezone: '+09:00' }).patient[
        'deceasedDateTime'
      ],
    ).toBe('2024-03-04T09:30:00+09:00');
    const withOffset = { column: 'V', transform: 'datetime', format: 'YYYY-MM-DDTHH:mm:ssZ' };
    const { patient } = tx(withOffset, '2024-03-04T09:30:00-05:00', 'Patient.deceasedDateTime', {
      timezone: '+09:00',
    });
    expect(patient['deceasedDateTime']).toBe('2024-03-04T09:30:00-05:00');
    expect(patterns.DATETIME.test(patient['deceasedDateTime'])).toBe(true);
  });

  it('datetime without any offset → date only + one warning per field', () => {
    const mapping = {
      fields: {
        'Patient.name.family': 'LAST',
        'Patient.deceasedDateTime': {
          column: 'V',
          transform: 'datetime',
          format: 'YYYY-MM-DD HH:mm',
        },
      },
    };
    const result = run(mapping, [
      { LAST: 'A', V: '2024-03-04 09:30' },
      { LAST: 'B', V: '2024-03-05 10:30' },
    ]);
    expect(result.byType('Patient').map((p) => p['deceasedDateTime'])).toEqual([
      '2024-03-04',
      '2024-03-05',
    ]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.message).toMatch(/no UTC offset .* set "timezone"/);
  });

  it('literals: top-level literals always emitted with the resource', () => {
    const result = run(
      {
        patientId: 'ID',
        fields: {
          'Patient.name.family': 'L',
          'Observation.code.text': 'T',
          'Observation.status': { literal: 'preliminary' },
        },
      },
      [{ ID: '1', L: 'Doe', T: 'x' }],
    );
    expect(result.byType('Observation')[0]!['status']).toBe('preliminary');
  });

  it('Excel Date cells work for date and datetime elements', () => {
    const result = run(
      {
        patientId: 'ID',
        timezone: '+09:00',
        fields: {
          'Patient.name.family': 'L',
          'Patient.birthDate': { column: 'DOB', transform: 'date', format: 'YYYY-MM-DD' },
          'Encounter.period.start': {
            column: 'AT',
            transform: 'datetime',
            format: 'YYYY-MM-DD HH:mm',
          },
        },
      },
      [
        {
          ID: '1',
          L: 'Doe',
          DOB: new Date(Date.UTC(1980, 3, 1)),
          AT: new Date(Date.UTC(2024, 2, 4, 9, 30)),
        },
      ],
    );
    expect(result.byType('Patient')[0]!['birthDate']).toBe('1980-04-01');
    expect(result.byType('Encounter')[0]!['period'].start).toBe('2024-03-04T09:30:00+09:00');
  });
});

describe('RowTransformer — patients, ids, validation', () => {
  it('ids are deterministic and namespaced; fullUrl matches id', () => {
    const a = run(HOSPITAL_MAPPING, [BASE_ROW], { idNamespace: 'file-a' });
    const b = run(HOSPITAL_MAPPING, [BASE_ROW], { idNamespace: 'file-a' });
    const c = run(HOSPITAL_MAPPING, [BASE_ROW], { idNamespace: 'file-b' });
    const ids = (r: typeof a) => r.resources.map((x) => x['id']);
    expect(ids(a)).toEqual(ids(b));
    expect(ids(a)).not.toEqual(ids(c));
    for (const id of ids(a)) expect(patterns.UUID.test(id)).toBe(true);
    expect(deterministicUuid('x')).toBe(deterministicUuid('x'));
  });

  it('ids do not depend on identifier values (no reversible hash of MRN/RRN)', () => {
    const a = run(HOSPITAL_MAPPING, [BASE_ROW]);
    const b = run(HOSPITAL_MAPPING, [{ ...BASE_ROW, MRN: 'OTHER' }]);
    expect(a.byType('Patient')[0]!['id']).toBe(b.byType('Patient')[0]!['id']);
  });

  it('merges the patientId column into the mapped identifier (no duplicate)', () => {
    const [patient] = run(HOSPITAL_MAPPING, [BASE_ROW]).byType('Patient');
    expect(patient!['identifier']).toHaveLength(1);
  });

  it('adds the patientId identifier first when it is not mapped explicitly', () => {
    const [patient] = run(
      {
        patientId: { column: 'MRN', system: 'urn:x:mrn' },
        fields: { 'Patient.name.family': 'L', 'Patient.identifier[].value': 'NATIONAL' },
      },
      [{ MRN: 'M1', L: 'Doe', NATIONAL: 'N-9' }],
    ).byType('Patient');
    expect(patient!['identifier']).toEqual([
      { system: 'urn:x:mrn', value: 'M1' },
      { value: 'N-9' },
    ]);
  });

  it('skips rows with an empty patientId (warning, no values)', () => {
    const result = run(HOSPITAL_MAPPING, [{ ...BASE_ROW, MRN: ' ' }]);
    expect(result.resources).toHaveLength(0);
    expect(result.stats.rowsSkipped).toBe(1);
    expect(formatImportIssue(result.issues[0]!)).toBe(
      'row 2, column "MRN": patientId column is empty — row skipped',
    );
  });

  it('without patientId every row is its own Patient', () => {
    const result = run({ fields: { 'Patient.name.family': 'L' } }, [{ L: 'A' }, { L: 'A' }]);
    expect(result.byType('Patient')).toHaveLength(2);
  });

  it('drops an invalid Patient and skips its dependent resources', () => {
    const result = run(HOSPITAL_MAPPING, [
      { ...BASE_ROW, LAST: '' },
      { ...BASE_ROW, LAST: '', VISIT: '02/04/2024 10:00' },
    ]);
    expect(result.resources).toHaveLength(0);
    expect(result.stats.resourcesDropped).toBe(7);
    expect(result.issues[0]!.message).toMatch(/^Patient dropped — name\[0\]\.family: /);
    expect(result.issues[1]!.message).toBe(
      'Encounter skipped: its Patient (first seen on row 2) failed validation',
    );
  });

  it('drops an Observation without code (required) and keeps the rest', () => {
    const result = run(HOSPITAL_MAPPING, [{ ...BASE_ROW, LOINC: '' }]);
    expect(result.byType('Observation')).toHaveLength(0);
    expect(result.byType('Condition')).toHaveLength(1);
    expect(result.issues[0]!).toMatchObject({ severity: 'error', row: 2 });
    expect(result.issues[0]!.message).toMatch(
      /^Observation dropped — code: Observation.code is required/,
    );
  });

  it('without Patient in resourceTypes, subject is a logical identifier reference', () => {
    const result = run(
      {
        patientId: { column: 'MRN', system: 'urn:x:mrn' },
        fields: { 'Observation.code.text': 'T' },
      },
      [{ MRN: 'M1', T: 'x' }],
    );
    const [obs] = result.byType('Observation');
    expect(obs!['subject']).toEqual({ identifier: { system: 'urn:x:mrn', value: 'M1' } });
    expectAllValid(result);
  });

  it('multi-sheet: rows limited to their types; unknown patient → logical reference', () => {
    const mapping = parseMappingConfig({
      patientId: { column: 'ID', system: 'urn:x' },
      sheet: { Patient: 'P', Encounter: 'E' },
      fields: { 'Patient.name.family': 'L', 'Encounter.class.code': 'C' },
    });
    const t = new RowTransformer(mapping);
    const p = t.transformRow(
      { rowNumber: 2, sheet: 'P', values: { ID: '1', L: 'Doe', C: 'AMB' } },
      ['Patient'],
    );
    expect(p.resources.map((r) => r.resource.resourceType)).toEqual(['Patient']);
    const e1 = t.transformRow({ rowNumber: 2, sheet: 'E', values: { ID: '1', C: 'AMB' } }, [
      'Encounter',
    ]);
    expect((e1.resources[0]!.resource as unknown as Json)['subject']).toEqual({
      reference: p.resources[0]!.fullUrl,
    });
    const e2 = t.transformRow({ rowNumber: 3, sheet: 'E', values: { ID: '9', C: 'AMB' } }, [
      'Encounter',
    ]);
    expect((e2.resources[0]!.resource as unknown as Json)['subject']).toEqual({
      identifier: { system: 'urn:x', value: '9' },
    });
    expect(formatImportIssue(e2.issues[0]!)).toBe(
      'row 3, sheet "E", column "ID": patient not found among Patient rows — referenced by identifier instead',
    );
  });
});

describe('RowTransformer — RRN (주민등록번호) protection', () => {
  const RRN = '800101-1234560';
  const KR = {
    patientId: { column: 'PID', system: 'urn:x:kr' },
    fields: {
      'Patient.identifier[].value': 'RRN',
      'Patient.name.family': 'L',
      'Condition.code.text': 'DX',
    },
  };
  const values = { PID: 'KR-1', RRN, L: '홍', DX: `환자 ${RRN} 메모` };

  it('hashes RRN identifiers with a secret and masks RRN in other text', () => {
    const result = run(KR, [values], { rrnSecret: 'secret-for-tests-0123456789abcdef' });
    const json = JSON.stringify(result.bundle);
    expect(json).not.toContain(RRN);
    expect(json).not.toContain('8001011234560');
    expect(containsRrn(json)).toBe(false);
    const [patient] = result.byType('Patient');
    expect(patient!['identifier'][1].value).toMatch(/^[0-9a-f]{16}$/);
    expect(result.byType('Condition')[0]!['code'].text).toBe('환자 ######-******* 메모');
    expect(result.stats.rrnValuesProtected).toBe(2);
  });

  it('masks RRN identifiers without a secret', () => {
    const result = run(KR, [values]);
    const [patient] = result.byType('Patient');
    expect(patient!['identifier'][1].value).toBe('######-*******');
    expect(containsRrn(JSON.stringify(result.bundle))).toBe(false);
  });

  it('protects an RRN used as patientId (identifier + logical references)', () => {
    const result = run(
      {
        patientId: { column: 'RRN' },
        fields: { 'Patient.name.family': 'L', 'Condition.code.text': 'DX' },
      },
      [values, { ...values, DX: 'x' }],
      { rrnSecret: 'secret-for-tests-0123456789abcdef' },
    );
    expect(result.byType('Patient')).toHaveLength(1); // dedupe still uses the raw value in memory
    expect(containsRrn(JSON.stringify(result.bundle))).toBe(false);
    expect(containsRrn(JSON.stringify(result.issues))).toBe(false);
  });

  it('never echoes RRN values in issues', () => {
    const result = run(
      {
        fields: {
          'Patient.name.family': 'L',
          'Patient.birthDate': { column: 'RRN', transform: 'date', format: 'YYYYMMDD' },
        },
      },
      [values],
    );
    expect(result.issues.length).toBeGreaterThan(0);
    expect(containsRrn(JSON.stringify(result.issues))).toBe(false);
  });
});

describe('RowTransformer — misc', () => {
  it('rejects a hand-built mapping with an unresolvable path', () => {
    const mapping = parseMappingConfig({ fields: { 'Patient.name.family': 'L' } });
    const broken = {
      ...mapping,
      fields: [{ ...mapping.fields[0]!, path: 'nope' }],
    };
    expect(() => new RowTransformer(broken)).toThrow(/Invalid mapping field/);
  });

  it('bundle resources are typed Resource objects', () => {
    const result = run(HOSPITAL_MAPPING, [BASE_ROW]);
    const r: Resource | undefined = result.bundle.entry?.[0]?.resource;
    expect(r?.resourceType).toBe('Patient');
  });
});
