/**
 * Tests for value-transforms: date/datetime formats, auto-detection, Excel
 * Date cells, timezone handling, strict numbers/booleans.
 */

import { describe, it, expect } from 'vitest';

import {
  cellToText,
  compileDateFormat,
  parseBoolean,
  parseDateValue,
  parseNumber,
  toFhirDate,
  toFhirDateTime,
  type CompiledDateFormat,
  type DateParts,
} from '../value-transforms.js';

function fmt(format: string): CompiledDateFormat {
  const compiled = compileDateFormat(format);
  if (typeof compiled === 'string') throw new Error(compiled);
  return compiled;
}

function parts(value: unknown, format?: string): DateParts {
  const result = parseDateValue(value, format ? fmt(format) : undefined);
  if (typeof result === 'string') throw new Error(result);
  return result;
}

describe('compileDateFormat', () => {
  it('compiles the documented formats', () => {
    for (const f of [
      'YYYY-MM-DD',
      'YYYY/MM/DD',
      'DD/MM/YYYY',
      'YYYYMMDD',
      'DD/MM/YYYY HH:mm',
      'YYYY-MM-DD HH:mm',
      'YYYY-MM-DDTHH:mm:ssZ',
    ]) {
      expect(typeof compileDateFormat(f)).toBe('object');
    }
    expect(fmt('DD/MM/YYYY HH:mm').hasTime).toBe(true);
    expect(fmt('YYYYMMDD').hasTime).toBe(false);
  });

  it('rejects unsupported tokens, duplicates and incomplete formats', () => {
    expect(compileDateFormat('D/M/YYYY')).toMatch(/unsupported token "D"/);
    expect(compileDateFormat('YYYY-MM-DD hh:mm')).toMatch(/unsupported token "hh"/);
    expect(compileDateFormat('DD/MM/YY')).toMatch(/unsupported token "YY"/);
    expect(compileDateFormat('MM-DD')).toMatch(/must contain YYYY/);
    expect(compileDateFormat('YYYY-DD')).toMatch(/has DD but no MM/);
    expect(compileDateFormat('YYYY-MM-DD mm')).toMatch(/has mm but no HH/);
    expect(compileDateFormat('YYYY YYYY')).toMatch(/appears twice/);
  });
});

describe('parseDateValue with an explicit format', () => {
  it.each([
    ['1985-03-15', 'YYYY-MM-DD', '1985-03-15'],
    ['1985/03/15', 'YYYY/MM/DD', '1985-03-15'],
    ['15/03/1985', 'DD/MM/YYYY', '1985-03-15'],
    ['5/3/1985', 'DD/MM/YYYY', '1985-03-05'],
    ['19850315', 'YYYYMMDD', '1985-03-15'],
  ])('%s with %s → %s', (input, format, expected) => {
    expect(toFhirDate(parts(input, format))).toBe(expected);
  });

  it('parses time and embedded offsets', () => {
    expect(parts('04/03/2024 08:30', 'DD/MM/YYYY HH:mm')).toEqual({
      year: 2024,
      month: 3,
      day: 4,
      hour: 8,
      minute: 30,
    });
    expect(parts('2024-03-04T09:30:00-05:00', 'YYYY-MM-DDTHH:mm:ssZ').offset).toBe('-05:00');
    expect(parts('2024-03-04T09:30:00+0700', 'YYYY-MM-DDTHH:mm:ssZ').offset).toBe('+07:00');
    expect(parts('2024-03-04T09:30:00Z', 'YYYY-MM-DDTHH:mm:ssZ').offset).toBe('Z');
  });

  it('rejects mismatches and impossible calendar values (no cell values in messages)', () => {
    expect(parseDateValue('1985-03-15', fmt('DD/MM/YYYY'))).toBe(
      'value does not match format "DD/MM/YYYY"',
    );
    expect(parseDateValue('30/02/2024', fmt('DD/MM/YYYY'))).toBe('day out of range');
    expect(parseDateValue('29/02/2023', fmt('DD/MM/YYYY'))).toBe('day out of range');
    expect(toFhirDate(parts('29/02/2024', 'DD/MM/YYYY'))).toBe('2024-02-29');
    expect(parseDateValue('15/13/2024', fmt('DD/MM/YYYY'))).toBe('month out of range');
    expect(parseDateValue('01/01/2024 25:00', fmt('DD/MM/YYYY HH:mm'))).toBe('hour out of range');
    expect(parseDateValue('2024-01-01T10:00:00+15:00', fmt('YYYY-MM-DDTHH:mm:ssZ'))).toBe(
      'invalid UTC offset',
    );
  });
});

describe('parseDateValue auto-detection (no format)', () => {
  it.each([
    ['1985-03-15', '1985-03-15'],
    ['1985/3/5', '1985-03-05'],
    ['19850315', '1985-03-15'],
    ['15/03/1985', '1985-03-15'],
    ['15.03.1985', '1985-03-15'],
    ['03/22/1985', '1985-03-22'], // DMY impossible → MDY
    ['1985', '1985'],
    ['1985-03', '1985-03'],
  ])('%s → %s', (input, expected) => {
    expect(toFhirDate(parts(input))).toBe(expected);
  });

  it('detects ISO-like datetimes with and without offsets', () => {
    expect(parts('2024-03-04 09:30')).toMatchObject({ hour: 9, minute: 30 });
    expect(parts('2024-03-04T09:30:15.123+09:00')).toMatchObject({ second: 15, offset: '+09:00' });
    expect(parts('04/03/2024 08:30')).toMatchObject({ day: 4, month: 3, hour: 8 });
  });

  it('rejects free text', () => {
    expect(parseDateValue('yesterday')).toMatch(/unrecognized date/);
    expect(parseDateValue('   ')).toBe('empty value');
  });
});

describe('parseDateValue with Excel Date cells', () => {
  it('treats UTC components as wall-clock; midnight means date only', () => {
    expect(parts(new Date(Date.UTC(1980, 3, 1)))).toEqual({ year: 1980, month: 4, day: 1 });
    expect(parts(new Date(Date.UTC(2024, 2, 4, 9, 30)))).toEqual({
      year: 2024,
      month: 3,
      day: 4,
      hour: 9,
      minute: 30,
      second: 0,
    });
  });

  it('rounds serial-number float noise to the nearest second', () => {
    // 45355.395833333 (serial) → 09:29:59.99997 without rounding
    expect(parts(new Date(Date.UTC(2024, 2, 4, 9, 30) - 0.03))).toMatchObject({
      hour: 9,
      minute: 30,
      second: 0,
    });
  });

  it('ignores the format for Date cells and rejects invalid dates', () => {
    expect(toFhirDate(parts(new Date(Date.UTC(2000, 0, 2)), 'DD/MM/YYYY'))).toBe('2000-01-02');
    expect(parseDateValue(new Date(NaN))).toBe('invalid date');
  });
});

describe('toFhirDateTime', () => {
  const p: DateParts = { year: 2024, month: 3, day: 4, hour: 9, minute: 5 };

  it('uses the value offset first, then the mapping timezone', () => {
    expect(toFhirDateTime({ ...p, offset: 'Z' }, '+09:00')).toEqual({
      value: '2024-03-04T09:05:00Z',
      timeDropped: false,
    });
    expect(toFhirDateTime(p, '+07:00')).toEqual({
      value: '2024-03-04T09:05:00+07:00',
      timeDropped: false,
    });
  });

  it('emits a date only when there is no offset at all (FHIR requires one with a time)', () => {
    expect(toFhirDateTime(p)).toEqual({ value: '2024-03-04', timeDropped: true });
    expect(toFhirDateTime({ year: 2024, month: 3, day: 4 })).toEqual({
      value: '2024-03-04',
      timeDropped: false,
    });
  });
});

describe('parseNumber / parseBoolean / cellToText', () => {
  it('parses strict decimals only', () => {
    expect(parseNumber('142')).toBe(142);
    expect(parseNumber(' -7.10 ')).toBe(-7.1);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('1e3')).toBe(1000);
    expect(parseNumber(72.5)).toBe(72.5);
    for (const bad of ['', '12abc', '1,234', '37,5', 'NaN', Infinity]) {
      expect(parseNumber(bad)).toBeUndefined();
    }
  });

  it('parses booleans case-insensitively', () => {
    expect(parseBoolean('Yes')).toBe(true);
    expect(parseBoolean('0')).toBe(false);
    expect(parseBoolean(true)).toBe(true);
    expect(parseBoolean('maybe')).toBeUndefined();
  });

  it('renders cells as text (Date cells without inventing an offset)', () => {
    expect(cellToText('  a ')).toBe('a');
    expect(cellToText(12)).toBe('12');
    expect(cellToText(new Date(Date.UTC(2024, 0, 2)))).toBe('2024-01-02');
    expect(cellToText(new Date(Date.UTC(2024, 0, 2, 3, 4, 5)))).toBe('2024-01-02T03:04:05');
  });
});
