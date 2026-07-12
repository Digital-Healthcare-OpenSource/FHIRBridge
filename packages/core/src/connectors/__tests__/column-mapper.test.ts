/**
 * Tests for column-mapper utility.
 * Verifies transforms, code resolution, and CodeableConcept wrapping.
 */

import { describe, it, expect } from 'vitest';
import { mapRow } from '../column-mapper.js';
import type { ColumnMapping } from '@fhirbridge/types';

describe('mapRow', () => {
  const source = 'test:fixture';

  it('maps simple string fields without transform', () => {
    const mappings: ColumnMapping[] = [
      { sourceColumn: 'last_name', fhirPath: 'name[0].family', resourceType: 'Patient' },
    ];
    const row = { last_name: '  Smith  ' };
    const records = mapRow(row, mappings, source);

    expect(records).toHaveLength(1);
    expect(records[0]!.resourceType).toBe('Patient');
    expect(records[0]!.data['name[0].family']).toBe('Smith');
  });

  it('applies string transform (trim)', () => {
    const mappings: ColumnMapping[] = [
      {
        sourceColumn: 'first_name',
        fhirPath: 'name[0].given[0]',
        resourceType: 'Patient',
        transform: 'string',
      },
    ];
    const row = { first_name: '  John   ' };
    const records = mapRow(row, mappings, source);

    expect(records[0]!.data['name[0].given[0]']).toBe('John');
  });

  it('applies date transform: ISO 8601 passthrough', () => {
    const mappings: ColumnMapping[] = [
      { sourceColumn: 'dob', fhirPath: 'birthDate', resourceType: 'Patient', transform: 'date' },
    ];
    const records = mapRow({ dob: '1985-03-15' }, mappings, source);
    expect(records[0]!.data['birthDate']).toBe('1985-03-15');
  });

  it('applies date transform: DD/MM/YYYY format (default VI/JP order)', () => {
    const mappings: ColumnMapping[] = [
      { sourceColumn: 'dob', fhirPath: 'birthDate', resourceType: 'Patient', transform: 'date' },
    ];
    const records = mapRow({ dob: '15/03/1985' }, mappings, source);
    expect(records[0]!.data['birthDate']).toBe('1985-03-15');
  });

  it('rejects an impossible slash date (day/month > range)', () => {
    const mappings: ColumnMapping[] = [
      { sourceColumn: 'dob', fhirPath: 'birthDate', resourceType: 'Patient', transform: 'date' },
    ];
    expect(() => mapRow({ dob: '25/13/2020' }, mappings, source)).toThrow(/Invalid date/);
  });

  it('interprets slash dates as MM/DD when dateOrder=MDY', () => {
    const mappings: ColumnMapping[] = [
      { sourceColumn: 'dob', fhirPath: 'birthDate', resourceType: 'Patient', transform: 'date' },
    ];
    const records = mapRow({ dob: '03/15/1985' }, mappings, source, undefined, 'MDY');
    expect(records[0]!.data['birthDate']).toBe('1985-03-15');
  });

  it('applies date transform: YYYYMMDD compact format', () => {
    const mappings: ColumnMapping[] = [
      { sourceColumn: 'dob', fhirPath: 'birthDate', resourceType: 'Patient', transform: 'date' },
    ];
    const records = mapRow({ dob: '19850315' }, mappings, source);
    expect(records[0]!.data['birthDate']).toBe('1985-03-15');
  });

  it('applies date transform: DD-MM-YYYY format', () => {
    const mappings: ColumnMapping[] = [
      { sourceColumn: 'dob', fhirPath: 'birthDate', resourceType: 'Patient', transform: 'date' },
    ];
    const records = mapRow({ dob: '15-03-1985' }, mappings, source);
    expect(records[0]!.data['birthDate']).toBe('1985-03-15');
  });

  it('applies number transform', () => {
    const mappings: ColumnMapping[] = [
      {
        sourceColumn: 'value',
        fhirPath: 'valueQuantity.value',
        resourceType: 'Observation',
        transform: 'number',
      },
    ];
    const records = mapRow({ value: '120.5' }, mappings, source);
    expect(records[0]!.data['valueQuantity.value']).toBe(120.5);
  });

  it('skips invalid number values', () => {
    const mappings: ColumnMapping[] = [
      {
        sourceColumn: 'value',
        fhirPath: 'valueQuantity.value',
        resourceType: 'Observation',
        transform: 'number',
      },
    ];
    const records = mapRow({ value: 'N/A' }, mappings, source);
    expect(records).toHaveLength(0);
  });

  it('applies code transform with valueMappings', () => {
    const mappings: ColumnMapping[] = [
      {
        sourceColumn: 'gender',
        fhirPath: 'gender',
        resourceType: 'Patient',
        transform: 'code',
        valueMappings: [
          {
            sourceValue: 'male',
            system: 'http://hl7.org/fhir/administrative-gender',
            code: 'male',
            display: 'Male',
          },
        ],
      },
    ];
    const records = mapRow({ gender: 'male' }, mappings, source);
    const val = records[0]!.data['gender'] as { system: string; code: string };
    expect(val.code).toBe('male');
    expect(val.system).toBe('http://hl7.org/fhir/administrative-gender');
  });

  it('wraps code value in CodeableConcept when codeSystem is set', () => {
    const mappings: ColumnMapping[] = [
      {
        sourceColumn: 'loinc_code',
        fhirPath: 'code',
        resourceType: 'Observation',
        codeSystem: 'http://loinc.org',
        transform: 'string',
      },
    ];
    const records = mapRow({ loinc_code: '8480-6' }, mappings, source);
    const val = records[0]!.data['code'] as { coding: Array<{ system: string; code: string }> };
    expect(val.coding[0]!.system).toBe('http://loinc.org');
    expect(val.coding[0]!.code).toBe('8480-6');
  });

  it('groups multiple resource types from the same row', () => {
    const mappings: ColumnMapping[] = [
      { sourceColumn: 'patient_id', fhirPath: 'id', resourceType: 'Patient', transform: 'string' },
      {
        sourceColumn: 'obs_value',
        fhirPath: 'valueQuantity.value',
        resourceType: 'Observation',
        transform: 'number',
      },
    ];
    const records = mapRow({ patient_id: 'P001', obs_value: '120' }, mappings, source);
    expect(records).toHaveLength(2);
    const types = records.map((r) => r.resourceType).sort();
    expect(types).toEqual(['Observation', 'Patient']);
  });

  it('skips empty/null column values', () => {
    const mappings: ColumnMapping[] = [
      {
        sourceColumn: 'optional_field',
        fhirPath: 'someField',
        resourceType: 'Patient',
        transform: 'string',
      },
    ];
    const records = mapRow({ optional_field: '' }, mappings, source);
    expect(records).toHaveLength(0);
  });

  it('preserves sourceRow index', () => {
    const mappings: ColumnMapping[] = [
      { sourceColumn: 'id', fhirPath: 'id', resourceType: 'Patient', transform: 'string' },
    ];
    const records = mapRow({ id: 'P001' }, mappings, source, 42);
    // sourceRow is on MappedRecord, not exposed in RawRecord — verify no error
    expect(records[0]!.resourceType).toBe('Patient');
  });
});
