/**
 * Tests for parseMappingConfig — canonical "fields" format, legacy formats
 * ({mappings}, {columns}, bare array, flat) and every validation error.
 */

import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

import { describe, it, expect } from 'vitest';

import { MappingConfigError, parseMappingConfig } from '../mapping-config-parser.js';

const REPO_ROOT = path.resolve(__dirname, '../../../../../../');
const EXAMPLES_DIR = path.join(REPO_ROOT, 'examples/column-mappings');
const LEGACY_FIXTURE = path.join(REPO_ROOT, 'tests/fixtures/csv/mapping-config.json');

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

/** Parse expecting failure; returns the collected issues. */
function issuesOf(input: unknown): string[] {
  try {
    parseMappingConfig(input);
  } catch (err) {
    expect(err).toBeInstanceOf(MappingConfigError);
    return (err as MappingConfigError).issues;
  }
  throw new Error('expected parseMappingConfig to throw');
}

const minimal = (extra: Record<string, unknown> = {}) => ({
  fields: { 'Patient.name.family': 'LAST' },
  ...extra,
});

describe('parseMappingConfig — canonical examples', () => {
  const files = readdirSync(EXAMPLES_DIR).filter(
    (f) => f.endsWith('.json') && f !== 'mapping.schema.json',
  );

  it('finds all four example mappings', () => {
    expect(files.sort()).toEqual([
      'csv-generic-hl7.json',
      'csv-korea-hospital.json',
      'csv-vneid-vn.json',
      'excel-japan-clinic.json',
    ]);
  });

  it.each(files)('%s parses without errors or notices', (file) => {
    const mapping = parseMappingConfig(readJson(path.join(EXAMPLES_DIR, file)));
    expect(mapping.sourceFormat).toBe('fields');
    expect(mapping.notices).toEqual([]);
    expect(mapping.fields.length).toBeGreaterThan(5);
    expect(mapping.resourceTypes[0]).toBe('Patient');
    expect(mapping.patientId?.column).toBeTruthy();
  });

  it('normalizes repeating elements to explicit indices', () => {
    const mapping = parseMappingConfig(readJson(path.join(EXAMPLES_DIR, 'csv-generic-hl7.json')));
    const paths = Object.fromEntries(mapping.fields.map((f) => [f.key, f.path]));
    expect(paths['Patient.name.family']).toBe('name[0].family');
    expect(paths['Patient.name.given']).toBe('name[0].given[0]');
    expect(paths['Patient.identifier[].value']).toBe('identifier[0].value');
    expect(paths['Condition.code.coding[].code']).toBe('code.coding[0].code');
    expect(paths['Encounter.class.code']).toBe('class.code');
  });

  it('keeps timezone, sheet map and patientId system', () => {
    const jp = parseMappingConfig(readJson(path.join(EXAMPLES_DIR, 'excel-japan-clinic.json')));
    expect(jp.timezone).toBe('+09:00');
    expect(jp.sheet).toEqual({ Patient: '患者', Encounter: '受診', Condition: '受診' });
    expect(jp.patientId).toEqual({
      column: '患者番号',
      system: 'https://fhirbridge.example/identifiers/jp-clinic-patient-id',
    });
  });

  it('accepts JSON text as well as objects', () => {
    const mapping = parseMappingConfig(JSON.stringify(minimal()));
    expect(mapping.fields).toHaveLength(1);
  });

  it('accepts patientId as a plain column name and derives resourceTypes', () => {
    const mapping = parseMappingConfig({
      patientId: 'MRN',
      fields: { 'Observation.code.text': 'TEST', 'Patient.name.family': 'LAST' },
    });
    expect(mapping.patientId).toEqual({ column: 'MRN' });
    expect(mapping.resourceTypes).toEqual(['Patient', 'Observation']);
  });

  it('parses column specs with transform/format/valueMap and literals', () => {
    const mapping = parseMappingConfig({
      fields: {
        'Patient.name.family': 'LAST',
        'Patient.gender': { column: 'SEX', transform: 'lowercase', valueMap: { M: 'male' } },
        'Patient.birthDate': { column: 'DOB', transform: 'date', format: 'DD/MM/YYYY' },
        'Patient.active': { literal: true },
      },
    });
    const bySource = Object.fromEntries(mapping.fields.map((f) => [f.key, f.source]));
    expect(bySource['Patient.gender']).toEqual({
      kind: 'column',
      column: 'SEX',
      transform: 'lowercase',
      valueMap: { M: 'male' },
    });
    expect(bySource['Patient.birthDate']).toMatchObject({ format: 'DD/MM/YYYY' });
    expect(bySource['Patient.active']).toEqual({ kind: 'literal', value: true });
  });

  it('allows $-prefixed keys such as $schema and $comment', () => {
    expect(() =>
      parseMappingConfig(minimal({ $schema: './mapping.schema.json', $comment: 'x' })),
    ).not.toThrow();
  });
});

describe('parseMappingConfig — canonical errors (precise messages)', () => {
  it('rejects invalid JSON text', () => {
    expect(issuesOf('{"fields": ')[0]).toMatch(/^mapping is not valid JSON/);
  });

  it('rejects non-object input', () => {
    expect(issuesOf(42)[0]).toMatch(/must be a JSON object, got number/);
    expect(issuesOf(null)[0]).toMatch(/got null/);
  });

  it('rejects mixing "fields" with a legacy list', () => {
    expect(issuesOf({ fields: {}, mappings: [] })[0]).toMatch(/mixes the canonical "fields"/);
  });

  it('rejects unknown top-level keys', () => {
    expect(issuesOf(minimal({ timezon: '+07:00' }))).toEqual([
      'unknown top-level key "timezon" (allowed: $schema, description, patientId, sheet, timezone, resourceTypes, fields)',
    ]);
  });

  it('rejects fields that are not an object or empty', () => {
    expect(issuesOf({ fields: [] })[0]).toMatch(/"fields" must be an object .* got array/);
    expect(issuesOf({ fields: {} })[0]).toMatch(/"fields" is empty/);
  });

  it('rejects keys without a resource type prefix', () => {
    expect(issuesOf({ fields: { gender: 'SEX' } })[0]).toBe(
      'fields["gender"]: key must look like "<ResourceType>.<path>", e.g. "Patient.name.family"',
    );
  });

  it('rejects unknown resource types', () => {
    expect(issuesOf({ fields: { 'Patinet.gender': 'SEX' } })[0]).toMatch(
      /^fields\["Patinet.gender"\]: unknown resource type "Patinet" \(supported: Patient, Encounter/,
    );
  });

  it('rejects unknown elements and lists the supported ones', () => {
    const [issue] = issuesOf({ fields: { 'Patient.nmae.family': 'X' } });
    expect(issue).toMatch(
      /^fields\["Patient.nmae.family"\]: "nmae" is not a supported element of Patient/,
    );
    expect(issue).toContain('name');
    const [nested] = issuesOf({ fields: { 'Patient.name.surname': 'X' } });
    expect(nested).toMatch(
      /"surname" is not a supported element of HumanName \(supported: .*family/,
    );
  });

  it('rejects an index on a non-repeating element', () => {
    expect(issuesOf({ fields: { 'Patient.gender[0]': 'X' } })[0]).toMatch(
      /"gender" is not a repeating element of Patient; remove "\[0\]"/,
    );
  });

  it('rejects paths ending at a complex type or continuing past a primitive', () => {
    expect(issuesOf({ fields: { 'Patient.name': 'X' } })[0]).toMatch(
      /"name" is a HumanName; map one of its elements instead \(use, text, family/,
    );
    expect(issuesOf({ fields: { 'Patient.gender.code': 'X' } })[0]).toMatch(
      /"gender" is a code value and has no child elements/,
    );
  });

  it('rejects malformed path segments', () => {
    expect(issuesOf({ fields: { 'Patient.name..family': 'X' } })[0]).toMatch(
      /invalid path segment ""/,
    );
  });

  it('rejects generated/auto-wired elements', () => {
    expect(issuesOf({ fields: { 'Patient.id': 'X' } })[0]).toMatch(
      /"id" is generated by the importer and cannot be mapped \(use "patientId"/,
    );
    expect(issuesOf({ patientId: 'MRN', fields: { 'Condition.subject.display': 'X' } })[0]).toMatch(
      /"Condition.subject" is set automatically \(it references the row's Patient\)/,
    );
    expect(
      issuesOf({ patientId: 'MRN', fields: { 'Observation.encounter.display': 'X' } })[0],
    ).toMatch(/references the row's Encounter/);
  });

  it('rejects bad field spec shapes', () => {
    expect(issuesOf({ fields: { 'Patient.gender': 5 } })[0]).toMatch(
      /expected a column name \(string\), \{"column": \.\.\.\} or \{"literal": \.\.\.\}, got number/,
    );
    expect(issuesOf({ fields: { 'Patient.name.family': '  ' } })[0]).toMatch(
      /column name must not be empty/,
    );
    expect(issuesOf({ fields: { 'Patient.name.family': { transform: 'trim' } } })[0]).toBe(
      'fields["Patient.name.family"].column must be a non-empty string',
    );
    expect(
      issuesOf({ fields: { 'Patient.name.family': { literal: 'x', column: 'y' } } })[0],
    ).toMatch(/a \{"literal": \.\.\.\} spec cannot also have "column"/);
  });

  it('rejects unknown spec keys (typos)', () => {
    expect(
      issuesOf({ fields: { 'Patient.gender': { column: 'SEX', transfrom: 'lowercase' } } })[0],
    ).toBe(
      'fields["Patient.gender"]: unknown key "transfrom" (allowed: column, transform, format, valueMap, or "literal" alone)',
    );
  });

  it('rejects unknown transforms', () => {
    expect(
      issuesOf({ fields: { 'Patient.gender': { column: 'SEX', transform: 'lower' } } })[0],
    ).toBe(
      'fields["Patient.gender"].transform: unknown transform "lower" (allowed: lowercase, uppercase, trim, date, datetime, number)',
    );
  });

  it('rejects format without a date/datetime transform and bad format tokens', () => {
    expect(
      issuesOf({ fields: { 'Patient.birthDate': { column: 'DOB', format: 'DD/MM/YYYY' } } })[0],
    ).toMatch(/\.format is only used with "transform": "date" or "datetime"/);
    expect(
      issuesOf({
        fields: { 'Patient.birthDate': { column: 'DOB', transform: 'date', format: 'D/M/YYYY' } },
      })[0],
    ).toMatch(/\.format: unsupported token "D" in format "D\/M\/YYYY"/);
    expect(
      issuesOf({
        fields: { 'Patient.birthDate': { column: 'DOB', transform: 'date', format: 'DD.MM.YY' } },
      })[0],
    ).toMatch(/unsupported token "YY"/);
    expect(
      issuesOf({
        fields: { 'Patient.birthDate': { column: 'DOB', transform: 'date', format: 'MM-DD' } },
      })[0],
    ).toMatch(/must contain YYYY/);
  });

  it('rejects invalid valueMap entries', () => {
    expect(issuesOf({ fields: { 'Patient.gender': { column: 'SEX', valueMap: [] } } })[0]).toMatch(
      /\.valueMap must be a non-empty object/,
    );
    expect(
      issuesOf({ fields: { 'Patient.gender': { column: 'SEX', valueMap: { M: 1 } } } })[0],
    ).toBe('fields["Patient.gender"].valueMap["M"] must be a string, got number');
  });

  it('checks literals against the element type and required code bindings', () => {
    expect(
      issuesOf({
        patientId: 'MRN',
        fields: {
          'Observation.code.text': 'T',
          'Observation.valueQuantity.value': { literal: 'abc' },
        },
      })[0],
    ).toMatch(/\.literal must be a number for a decimal element/);
    expect(issuesOf({ fields: { 'Patient.gender': { literal: 'M' } } })).toContain(
      'fields["Patient.gender"].literal "M" is not a valid code (allowed: male, female, other, unknown)',
    );
    expect(issuesOf({ fields: { 'Patient.active': { literal: 'maybe' } } })).toContain(
      'fields["Patient.active"].literal must be true or false for a boolean element',
    );
    expect(issuesOf({ fields: { 'Patient.name.family': { literal: [1] } } })[0]).toMatch(
      /\.literal must be a string, number or boolean, got array/,
    );
  });

  it('rejects invalid patientId', () => {
    expect(issuesOf(minimal({ patientId: 7 }))[0]).toMatch(/"patientId" must be a column name/);
    expect(issuesOf(minimal({ patientId: { col: 'MRN' } }))).toEqual([
      '"patientId": unknown key "col" (allowed: column, system)',
      '"patientId.column" must be a non-empty string',
    ]);
    expect(issuesOf(minimal({ patientId: { column: 'MRN', system: 'not a uri' } }))[0]).toMatch(
      /"patientId.system" must be an absolute URI/,
    );
  });

  it('rejects IANA timezone names with a hint', () => {
    expect(issuesOf(minimal({ timezone: 'Asia/Seoul' }))[0]).toMatch(
      /"timezone" must be a UTC offset like "\+07:00".*IANA names/,
    );
    expect(issuesOf(minimal({ timezone: '+7' }))[0]).toMatch(/"timezone" must be a UTC offset/);
  });

  it('validates resourceTypes', () => {
    expect(issuesOf(minimal({ resourceTypes: 'Patient' }))[0]).toMatch(
      /"resourceTypes" must be a non-empty array/,
    );
    expect(issuesOf(minimal({ resourceTypes: ['Patient', 'Medication'] }))[0]).toMatch(
      /unsupported resource type "Medication"/,
    );
    expect(issuesOf(minimal({ resourceTypes: ['Patient', 'Patient'] }))[0]).toBe(
      '"resourceTypes": "Patient" is listed twice',
    );
    expect(
      issuesOf({
        resourceTypes: ['Patient'],
        fields: { 'Patient.name.family': 'L', 'Observation.code.text': 'T' },
      })[0],
    ).toBe(
      'fields["Observation.code.text"]: resource type "Observation" is not listed in "resourceTypes" (Patient)',
    );
    expect(issuesOf(minimal({ resourceTypes: ['Patient', 'Encounter'] }))).toContain(
      '"resourceTypes" includes "Encounter" but no field maps a column to it',
    );
  });

  it('requires a patient for types that reference one', () => {
    expect(issuesOf({ fields: { 'Condition.code.text': 'DX' } })).toContain(
      'Condition needs a patient to reference: add "Patient" to "resourceTypes" or set "patientId"',
    );
  });

  it('validates sheet', () => {
    expect(issuesOf(minimal({ sheet: 3 }))[0]).toMatch(/"sheet" must be a sheet name or/);
    expect(
      issuesOf({
        patientId: 'ID',
        sheet: { Patient: 'P' },
        fields: { 'Patient.name.family': 'L', 'Encounter.class.code': 'C' },
      })[0],
    ).toBe(
      '"sheet" is per resource type, so it must name a sheet for every entry in "resourceTypes" — missing: Encounter',
    );
    expect(issuesOf(minimal({ sheet: { Patient: 'P', Condition: 'C' } }))[0]).toBe(
      '"sheet": "Condition" is not in "resourceTypes" (Patient)',
    );
  });

  it('rejects two keys that map to the same element', () => {
    expect(
      issuesOf({ fields: { 'Patient.name.family': 'A', 'Patient.name[0].family': 'B' } })[0],
    ).toBe(
      'fields["Patient.name.family"] and fields["Patient.name[0].family"] both map to Patient.name[0].family',
    );
  });

  it('collects every problem, not just the first', () => {
    const issues = issuesOf({
      timezone: 'CET',
      fields: { 'Patient.nmae': 'X', 'Patient.gender': { column: 'G', transform: 'nope' } },
    });
    expect(issues).toHaveLength(3);
    const err = (() => {
      try {
        parseMappingConfig({ timezone: 'CET', fields: { 'Patient.nmae': 'X' } });
      } catch (e) {
        return e as Error;
      }
      return undefined;
    })();
    expect(err?.message).toMatch(/^Invalid column mapping \(2 problems\):\n {2}- /);
  });
});

describe('parseMappingConfig — legacy {mappings: [...]} format', () => {
  it('normalizes tests/fixtures/csv/mapping-config.json', () => {
    const mapping = parseMappingConfig(readJson(LEGACY_FIXTURE));
    expect(mapping.sourceFormat).toBe('mappings');
    expect(mapping.patientId).toEqual({ column: 'patient_id' });
    expect(mapping.resourceTypes).toEqual(['Patient']);
    expect(mapping.notices.join('\n')).toMatch(/Patient\.id → patientId/);
    const bySource = Object.fromEntries(mapping.fields.map((f) => [f.path, f.source]));
    expect(bySource['name[0].given[0]']).toEqual({
      kind: 'column',
      column: 'first_name',
      transform: 'trim',
    });
    expect(bySource['birthDate']).toMatchObject({ transform: 'date' });
    // transform "code" + valueMappings → valueMap source value → code
    expect(bySource['gender']).toMatchObject({
      valueMap: { male: 'male', female: 'female', other: 'other', unknown: 'unknown' },
    });
  });

  it('expands codeSystem on a CodeableConcept into coding[0].code/system + text', () => {
    const mapping = parseMappingConfig({
      mappings: [
        { sourceColumn: 'pid', fhirPath: 'id', resourceType: 'Patient' },
        { sourceColumn: 'last', fhirPath: 'name[0].family', resourceType: 'Patient' },
        {
          sourceColumn: 'loinc',
          fhirPath: 'code',
          resourceType: 'Observation',
          codeSystem: 'http://loinc.org',
        },
        {
          sourceColumn: 'cls',
          fhirPath: 'class',
          resourceType: 'Encounter',
          transform: 'code',
          valueMappings: [
            {
              sourceValue: 'outpatient',
              system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
              code: 'AMB',
              display: 'ambulatory',
            },
          ],
        },
      ],
    });
    const byPath = Object.fromEntries(
      mapping.fields.map((f) => [`${f.resourceType}.${f.path}`, f.source]),
    );
    expect(byPath['Observation.code.coding[0].code']).toEqual({ kind: 'column', column: 'loinc' });
    expect(byPath['Observation.code.coding[0].system']).toEqual({
      kind: 'literal',
      value: 'http://loinc.org',
    });
    expect(byPath['Observation.code.text']).toEqual({ kind: 'column', column: 'loinc' });
    expect(byPath['Encounter.class.code']).toEqual({
      kind: 'column',
      column: 'cls',
      valueMap: { outpatient: 'AMB' },
    });
    expect(byPath['Encounter.class.system']).toMatchObject({ kind: 'literal' });
  });

  it('accepts the old API {columns: [...]} shape and a bare array', () => {
    const entry = { sourceColumn: 'last', fhirPath: 'name[0].family', resourceType: 'Patient' };
    expect(parseMappingConfig({ columns: [entry] }).sourceFormat).toBe('columns');
    expect(parseMappingConfig([entry]).fields[0]!.path).toBe('name[0].family');
  });

  it('reports precise legacy errors', () => {
    expect(issuesOf({ mappings: [] })[0]).toBe('"mappings" is empty — map at least one column');
    expect(issuesOf({ mappings: ['x'] })[0]).toMatch(/^mappings\[0\] must be an object/);
    expect(
      issuesOf({
        mappings: [
          { sourceColumn: 'a', fhirPath: 'gender', resourceType: 'Patient', transform: 'upper' },
        ],
      })[0],
    ).toBe(
      'mappings[0].transform: unknown legacy transform "upper" (allowed: date, code, string, number)',
    );
    expect(issuesOf({ columns: [{ fhirPath: 'gender', resourceType: 'Patient' }] })[0]).toBe(
      'columns[0].sourceColumn must be a non-empty string',
    );
    expect(
      issuesOf({
        mappings: [
          { sourceColumn: 'a', fhirPath: 'gender', resourceType: 'Patient', valueMappings: [{}] },
        ],
      })[0],
    ).toMatch(/mappings\[0\]\.valueMappings\[0\] must have string "sourceValue" and "code"/);
    // path errors surface with the legacy label
    expect(
      issuesOf({ mappings: [{ sourceColumn: 'a', fhirPath: 'nmae', resourceType: 'Patient' }] })[0],
    ).toMatch(/^mappings\[0\]: "nmae" is not a supported element of Patient/);
  });
});

describe('parseMappingConfig — legacy flat {column: fhirPath} format', () => {
  it('prefixes unprefixed paths with the default resource type (Patient)', () => {
    const mapping = parseMappingConfig({
      patient_id: 'id',
      last: 'name[0].family',
      dob: 'birthDate',
    });
    expect(mapping.sourceFormat).toBe('flat');
    expect(mapping.patientId).toEqual({ column: 'patient_id' });
    expect(mapping.fields.map((f) => `${f.resourceType}.${f.path}`)).toEqual([
      'Patient.name[0].family',
      'Patient.birthDate',
    ]);
    expect(mapping.notices.some((n) => /flat/.test(n))).toBe(true);
  });

  it('honors defaultResourceType and explicit prefixes', () => {
    const mapping = parseMappingConfig(
      {
        mrn: 'Patient.identifier[0].value',
        last: 'Patient.name.family',
        loinc: 'code.coding[0].code',
      },
      { defaultResourceType: 'Observation' },
    );
    expect(mapping.resourceTypes).toEqual(['Patient', 'Observation']);
  });

  it('reports unrecognized formats with a hint to the canonical format', () => {
    expect(issuesOf({ patientId: { column: 'x' } })[0]).toMatch(
      /unrecognized mapping format: key "patientId" has a object value\. Expected the canonical format/,
    );
    expect(issuesOf({})[0]).toMatch(/mapping has no fields/);
  });
});
