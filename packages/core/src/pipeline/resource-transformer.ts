/**
 * Raw data to FHIR resource transformer.
 * Maps arbitrary key-value records to typed FHIR R4 resources.
 */

import type { Resource } from '@fhirbridge/types';

import { hashIdentifier } from '../ai/deidentifier.js';
import { containsRrn, maskRrn } from '../security/rrn-detector.js';

/** A raw record from a source system (HIS, CSV, etc.) */
export type RawRecord = Record<string, unknown>;

/**
 * Custom field mapping config.
 * Keys are source field names; values are FHIR paths (dot notation).
 * Example: { 'pt_name_family': 'name[0].family', 'dob': 'birthDate' }
 */
export type MappingConfig = Record<string, string>;

/**
 * Order of a slash-separated date (`d/m/y` vs `m/d/y`).
 * Default is `DMY` because FHIRBridge targets VI/JP HIS exports where
 * `DD/MM/YYYY` is the norm; pass `MDY` for US-format sources.
 */
export type SlashDateOrder = 'DMY' | 'MDY';

/**
 * Transform raw HIS data into a FHIR Resource.
 *
 * Default behavior: direct field-name match.
 * Custom mapping: use mappingConfig to rename fields and flatten paths.
 *
 * @param rawData - Source record from HIS or CSV
 * @param resourceType - Target FHIR resource type (e.g., 'Patient')
 * @param mappingConfig - Optional field remapping
 * @param dateOrder - Slash-date interpretation order (default `DMY` for VI/JP)
 * @param rrnSecret - HMAC secret để hash RRN (주민등록번호) ở cột identifier.
 *   PIPA: RRN không được đi tiếp dạng raw — có secret thì hash (giữ tính duy nhất
 *   cho dedupe), không có secret thì mask `######-*******`.
 * @throws {Error} when a recognized date has an impossible month/day (fail-fast,
 *   never emit a wrong clinical date)
 */
export function transformToFhir(
  rawData: RawRecord,
  resourceType: string,
  mappingConfig?: MappingConfig,
  dateOrder: SlashDateOrder = 'DMY',
  rrnSecret?: string,
): Resource {
  const result: RawRecord = { resourceType };

  if (!mappingConfig) {
    // Default: direct field-name copy with date normalization
    for (const [key, value] of Object.entries(rawData)) {
      result[key] = normalizeValue(key, value, dateOrder, rrnSecret);
    }
    return result as unknown as Resource;
  }

  // Custom mapping: apply the mapping config
  for (const [sourceField, fhirPath] of Object.entries(mappingConfig)) {
    if (!(sourceField in rawData)) continue;

    const value = normalizeValue(fhirPath, rawData[sourceField], dateOrder, rrnSecret);
    setNestedValue(result, fhirPath, value);
  }

  return result as unknown as Resource;
}

/**
 * Normalize a field value based on its FHIR path.
 * Handles date format normalization and boolean coercion.
 */
function normalizeValue(
  fieldPath: string,
  value: unknown,
  dateOrder: SlashDateOrder,
  rrnSecret?: string,
): unknown {
  if (value === null || value === undefined) return undefined;

  // PIPA guard: RRN (주민등록번호) không bao giờ đi tiếp dạng raw.
  // - Cột identifier: hash HMAC nếu có secret (giữ uniqueness), else mask.
  // - Field string khác: mask — export path không đi qua deidentifier nên đây
  //   là chốt chặn duy nhất trước khi dữ liệu rời pipeline.
  if (typeof value === 'string' && containsRrn(value)) {
    if (fieldPath.includes('identifier') && rrnSecret) {
      return hashIdentifier(value.trim(), rrnSecret);
    }
    return maskRrn(value);
  }

  // Normalize date fields to ISO 8601
  const dateFields = ['birthDate', 'recordedDate', 'onsetDateTime', 'authoredOn'];
  if (dateFields.some((f) => fieldPath.endsWith(f)) && typeof value === 'string') {
    return normalizeDate(value, dateOrder);
  }

  // Coerce boolean strings
  if (value === 'true') return true;
  if (value === 'false') return false;

  return value;
}

/**
 * Normalize a date string to ISO 8601 YYYY-MM-DD.
 * Handles common formats: slash (order per `dateOrder`, default DD/MM/YYYY),
 * DD-MM-YYYY dash, and YYYYMMDD compact.
 *
 * Impossible dates (month > 12, day > 31, or an invalid YYYYMMDD like
 * `20201399`) are REJECTED by throwing rather than emitting a bad FHIR date.
 * Unrecognized free-text formats are returned unchanged.
 */
function normalizeDate(dateStr: string, dateOrder: SlashDateOrder = 'DMY'): string {
  // Already ISO 8601
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;

  // Slash format — order depends on dateOrder (default DD/MM/YYYY for VI/JP)
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, first, second, y] = slashMatch;
    const { day, month } = resolveDayMonth(first!, second!, dateOrder);
    return buildIsoDate(y!, month, day, dateStr);
  }

  // Dash format — same order resolution as slash (DD-MM-YYYY mặc định)
  const dmyMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmyMatch) {
    const [, first, second, y] = dmyMatch;
    const { day, month } = resolveDayMonth(first!, second!, dateOrder);
    return buildIsoDate(y!, month, day, dateStr);
  }

  // YYYYMMDD compact
  const compactMatch = dateStr.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    const [, y, m, d] = compactMatch;
    return buildIsoDate(y!, m!, d!, dateStr);
  }

  // Return as-is if unrecognized
  return dateStr;
}

/**
 * Resolve day/month for a two-number date per `dateOrder`, nhưng tự
 * disambiguate khi cách đọc theo order cho ra tháng > 12 mà cách đọc ngược lại
 * hợp lệ (vd `07/22/1985` dưới DMY → tháng 22 vô lý → hiểu là 22 July).
 * Chỉ giá trị mơ hồ (cả hai ≤ 12) mới tin hoàn toàn vào `dateOrder`.
 * Cả hai cách đọc đều vô lý → để buildIsoDate throw.
 */
function resolveDayMonth(
  first: string,
  second: string,
  dateOrder: SlashDateOrder,
): { day: string; month: string } {
  let day = dateOrder === 'DMY' ? first : second;
  let month = dateOrder === 'DMY' ? second : first;
  if (Number(month) > 12 && Number(day) <= 12) {
    [day, month] = [month, day];
  }
  return { day, month };
}

/** Validate month/day ranges and zero-pad; throw on an impossible date. */
function buildIsoDate(year: string, month: string, day: string, original: string): string {
  const mm = Number(month);
  const dd = Number(day);
  if (!Number.isInteger(mm) || !Number.isInteger(dd) || mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    throw new Error(`Invalid date: ${original}`);
  }
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Set a value at a dot-notation path on an object.
 * Supports simple paths like 'name[0].family'.
 */
function setNestedValue(obj: RawRecord, path: string, value: unknown): void {
  // Split on dots, handling array notation like name[0]
  const segments = path.split('.');
  let current: RawRecord = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const { key, index } = parseSegment(segment);

    if (index !== undefined) {
      if (!Array.isArray(current[key])) current[key] = [];
      const arr = current[key] as RawRecord[];
      if (!arr[index]) arr[index] = {};
      current = arr[index]!;
    } else {
      if (!current[key] || typeof current[key] !== 'object') current[key] = {};
      current = current[key] as RawRecord;
    }
  }

  const lastSegment = segments[segments.length - 1]!;
  const { key, index } = parseSegment(lastSegment);

  if (index !== undefined) {
    if (!Array.isArray(current[key])) current[key] = [];
    (current[key] as unknown[])[index] = value;
  } else {
    current[key] = value;
  }
}

/** Parse a path segment like 'name[0]' into { key: 'name', index: 0 } */
function parseSegment(segment: string): { key: string; index?: number } {
  const match = segment.match(/^([^[]+)\[(\d+)\]$/);
  if (match) {
    return { key: match[1]!, index: parseInt(match[2]!, 10) };
  }
  return { key: segment };
}
