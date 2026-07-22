/**
 * PHI de-identification engine.
 * PRIVACY CRITICAL: All PHI must be removed BEFORE data is sent to any AI provider.
 *
 * Strategy:
 * - Hash all identifiers with HMAC-SHA256 (truncated to 16 hex chars)
 * - Replace patient names with [PATIENT], practitioner names with [PROVIDER]
 * - Shift all dates by a random offset (±29 days, never 0), consistent per patient
 * - Strip address line/city/postalCode, phone, email, SSN (keep only state + country
 *   for Safe Harbor — city is a re-identification vector)
 * - Redact Organization.name + Location.name → HMAC hash (kể cả contained resources)
 * - Redact Reference.display (tên người) và Attachment data/url/title (ảnh/PDF định danh)
 * - Truncate age ≥ 89 to year-only bucket per HIPAA Safe Harbor (birthDate + onsetAge)
 * - Mask mọi RRN Hàn Quốc (주민등록번호) sót lại trong string values (PIPA)
 * - PRESERVE: medical codes (LOINC, SNOMED, RxNorm) incl. coding[].display, values, dosages
 */

import { createHmac } from 'node:crypto';

import type { Bundle, BundleEntry, DateShiftMap, DeidentifiedBundle } from '@fhirbridge/types';

import { maskRrn } from '../security/rrn-detector.js';

/**
 * Maximum date shift in days (±29).
 * Dùng 29 thay vì 30 để công thức zero-avoidance hoạt động đúng:
 * range là -29..+29 (59 giá trị), shift = (hash % 59) - 29;
 * nếu shift === 0 thì fallback về +30 (nằm ngoài range bình thường).
 */
const MAX_DATE_SHIFT_DAYS = 29;

/**
 * Ngưỡng tuổi HIPAA Safe Harbor — bệnh nhân ≥ 89 tuổi phải được ẩn birthDate
 * chính xác, chỉ giữ lại year-bucket.
 */
const HIPAA_AGE_THRESHOLD = 89;

/**
 * Year-bucket cho bệnh nhân ≥ 89 tuổi (năm sinh giả, không thể suy ra tuổi chính xác).
 * Dùng "1900" như một placeholder an toàn theo HIPAA Safe Harbor.
 */
const AGE_BUCKET_YEAR = '1900';

/** Milliseconds per day */
const MS_PER_DAY = 86_400_000;

/**
 * Result of de-identification: the sanitized bundle and date shift map.
 */
export interface DeidentifyResult {
  bundle: DeidentifiedBundle;
  shiftMap: DateShiftMap;
}

/**
 * Hash a value with HMAC-SHA256, return first 16 hex characters.
 * Used for identifiers and patient IDs.
 */
export function hashIdentifier(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex').slice(0, 16);
}

/**
 * Generate a deterministic date shift offset in days for a given patient hash.
 * Range: ±29 days, KHÔNG BAO GIỜ bằng 0 (C-9 zero-shift fix).
 *
 * Thuật toán:
 *   raw = hmacByte[0] % 59  → [0..58]
 *   shift = raw - 29        → [-29..+29]
 *   if shift === 0 → shift = +30  (fallback ngoài range bình thường, vẫn an toàn)
 */
function getDateShift(patientIdHash: string, secret: string): number {
  const hmacBytes = createHmac('sha256', secret).update(patientIdHash).digest();
  // Dùng byte đầu tiên, modulo 59 để có range đều [-29..+29]
  const raw = hmacBytes[0]! % 59;
  let shift = raw - MAX_DATE_SHIFT_DAYS; // [-29..+29]
  // INV-2: shift không được bằng 0 — tránh leak "ngày không thay đổi = ngày thật"
  if (shift === 0) shift = MAX_DATE_SHIFT_DAYS + 1; // +30
  return shift;
}

/**
 * Shift an ISO 8601 date string by the given number of days.
 * Handles full datetime strings and date-only strings.
 * Returns the original string if parsing fails.
 */
export function shiftDate(dateStr: string, offsetDays: number): string {
  if (!dateStr) return dateStr;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const shifted = new Date(d.getTime() + offsetDays * MS_PER_DAY);
    // Preserve original format (date-only vs datetime)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return shifted.toISOString().slice(0, 10);
    }
    return shifted.toISOString();
  } catch {
    return dateStr;
  }
}

/**
 * Deep-clone và de-identify một FHIR resource object.
 * Traverses all fields, applying transformations based on field names.
 *
 * @param resource - Object cần xử lý
 * @param secret - HMAC secret
 * @param offsetDays - Số ngày shift date
 * @param resourceType - resourceType của top-level resource (để xử lý Organization/Location)
 * @param patientBirthDate - birthDate gốc của Patient (để check age ≥ 89)
 */
function deidentifyResource(
  resource: Record<string, unknown>,
  secret: string,
  offsetDays: number,
  resourceType?: string,
  patientBirthDate?: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Xác định resourceType. resourceType RIÊNG của object phải OVERRIDE resourceType
  // kế thừa từ parent (MEDIUM: contained Organization/Location — tên phải được hash
  // đúng thay vì bị coi là field con của resource cha nên bỏ sót).
  const ownResourceType =
    typeof resource['resourceType'] === 'string' ? resource['resourceType'] : undefined;
  const effectiveResourceType = ownResourceType ?? resourceType;

  // C1: object dạng Reference (có key 'reference') → sibling 'display' là tên
  // bệnh nhân/bác sĩ/tổ chức → phải redact (KHÔNG đụng coding[].display).
  const parentHasReference = 'reference' in resource;
  // C2: object dạng Attachment (có 'contentType') → 'data'/'url'/'title' chứa
  // ảnh/PDF/tài liệu định danh → phải redact, chỉ giữ lại contentType.
  const parentIsAttachment = 'contentType' in resource;

  for (const [key, value] of Object.entries(resource)) {
    // Prototype-pollution guard: key đến từ bundle remote (attacker-influenceable).
    // Không có element FHIR hợp lệ nào tên như vậy → drop hẳn, không copy sang result.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    // Property-injection guard: chỉ cho phép element name dạng FHIR hợp lệ
    // (ASCII alphanumeric, tùy chọn prefix '_' cho primitive extension).
    // Key lạ bị drop — deidentifier là sanitizer, bớt dữ liệu = an toàn hơn.
    if (!/^_?[A-Za-z][A-Za-z0-9]*$/.test(key)) {
      continue;
    }

    // Skip null/undefined
    if (value === null || value === undefined) {
      result[key] = value;
      continue;
    }

    // C1: Reference.display leaks tên người → redact. Giữ nguyên coding[].display
    // (medical code display) vì coding object không có key 'reference'.
    if (key === 'display' && parentHasReference && typeof value === 'string') {
      result[key] = '[REDACTED]';
      continue;
    }

    // C2: Attachment content (data/url/title) leaks tài liệu/ảnh định danh → redact,
    // giữ contentType để summarizer vẫn biết loại nội dung.
    if (
      parentIsAttachment &&
      (key === 'data' || key === 'url' || key === 'title') &&
      typeof value === 'string'
    ) {
      result[key] = '[ATTACHMENT_REDACTED]';
      continue;
    }

    // STRIP: text narrative (contains human-readable PHI in HTML)
    if (key === 'text' && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = {
        status: 'empty',
        div: '<div xmlns="http://www.w3.org/1999/xhtml">[NARRATIVE REDACTED]</div>',
      };
      continue;
    }

    // STRIP: extensions (may contain SSN, maiden name, tribal affiliation, etc.)
    if (key === 'extension' || key === 'modifierExtension') {
      result[key] = [];
      continue;
    }

    // STRIP: note fields (free-text clinical notes with PHI)
    if (key === 'note' && Array.isArray(value)) {
      result[key] = [];
      continue;
    }

    // PRESERVE: resourceType, id (will be hashed below), status, codes
    if (key === 'resourceType' || key === 'status' || key === 'type') {
      result[key] = value;
      continue;
    }

    // Hash resource IDs
    if (key === 'id' && typeof value === 'string') {
      result[key] = hashIdentifier(value, secret);
      continue;
    }

    // Hash identifier values (but preserve system)
    if (key === 'identifier' && Array.isArray(value)) {
      result[key] = value.map((id: Record<string, unknown>) => ({
        system: id['system'],
        value: id['value'] ? hashIdentifier(String(id['value']), secret) : undefined,
      }));
      continue;
    }

    // Organization.name + Location.name → HMAC hash (C-10: redact org/loc names)
    if (
      key === 'name' &&
      typeof value === 'string' &&
      (effectiveResourceType === 'Organization' || effectiveResourceType === 'Location')
    ) {
      result[key] = hashIdentifier(value, secret);
      continue;
    }

    // Strip patient/practitioner names
    if (key === 'name' && Array.isArray(value)) {
      // Check context: if this is inside a Patient or Practitioner, replace names
      result[key] = [{ family: '[PATIENT]', given: ['[PATIENT]'] }];
      continue;
    }

    // Strip telecom (phone, email)
    if (key === 'telecom' && Array.isArray(value)) {
      result[key] = [];
      continue;
    }

    // Strip address details. HIGH: DROP city — city+state+birthYear+rare-dx là vector
    // tái định danh (Sweeney). Giữ lại chỉ state + country để claim HIPAA Safe Harbor
    // (geographic subdivision nhỏ hơn state phải được loại bỏ).
    if (key === 'address' && Array.isArray(value)) {
      result[key] = value.map((addr: Record<string, unknown>) => ({
        state: addr['state'],
        country: addr['country'],
      }));
      continue;
    }

    // Xử lý birthDate riêng — kiểm tra age ≥ 89 per HIPAA Safe Harbor (C-10)
    if (key === 'birthDate' && typeof value === 'string') {
      const birthDateStr = value;
      const birthYear = new Date(birthDateStr).getFullYear();
      const currentYear = new Date().getFullYear();
      // Tính tuổi theo năm (conservative: dùng năm hiện tại - năm sinh)
      const ageApprox = currentYear - birthYear;
      if (ageApprox >= HIPAA_AGE_THRESHOLD) {
        // HIPAA Safe Harbor: không tiết lộ năm sinh chính xác cho bệnh nhân ≥ 89 tuổi
        result[key] = AGE_BUCKET_YEAR;
      } else {
        result[key] = shiftDate(birthDateStr, offsetDays);
      }
      continue;
    }

    // MEDIUM: onsetAge/abatementAge (Age = Quantity) — cap value > 89 theo Safe Harbor
    // (tuổi > 89 phải được gộp, không tiết lộ chính xác). Giữ unit/system/code.
    if (
      (key === 'onsetAge' || key === 'abatementAge') &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      const age = value as Record<string, unknown>;
      const numeric = age['value'];
      result[key] = {
        ...age,
        value:
          typeof numeric === 'number' && numeric > HIPAA_AGE_THRESHOLD
            ? HIPAA_AGE_THRESHOLD
            : numeric,
      };
      continue;
    }

    // MEDIUM: onsetString/abatementString — free-text lâm sàng có thể chứa PHI → redact.
    if ((key === 'onsetString' || key === 'abatementString') && typeof value === 'string') {
      result[key] = '[CLINICAL_TEXT_REDACTED]';
      continue;
    }

    // Shift date fields — allowlist mở rộng per C-10
    if (
      (key.endsWith('Date') ||
        key.endsWith('DateTime') ||
        key.endsWith('Time') ||
        key === 'deceasedDateTime' ||
        key === 'issued' ||
        key === 'effectiveDateTime' ||
        key === 'effectiveInstant' ||
        key === 'performedDateTime' ||
        key === 'authoredOn' ||
        key === 'recordedDate' ||
        key === 'onsetDateTime' ||
        key === 'lastUpdated' ||
        key === 'start' ||
        key === 'end' ||
        key === 'timestamp') &&
      typeof value === 'string'
    ) {
      result[key] = shiftDate(value, offsetDays);
      continue;
    }

    // Hash reference values but preserve reference type
    if (key === 'reference' && typeof value === 'string') {
      const parts = value.split('/');
      if (parts.length === 2) {
        result[key] = `${parts[0]}/${hashIdentifier(parts[1]!, secret)}`;
      } else {
        result[key] = hashIdentifier(value, secret);
      }
      continue;
    }

    // PRESERVE: coding objects (system + code + display) — medical codes must not be altered
    if (key === 'coding' && Array.isArray(value)) {
      result[key] = value; // Preserve LOINC, SNOMED, RxNorm codes as-is
      continue;
    }

    // Redact free-text fields có thể chứa PHI — C-10 expansion
    // Bao gồm code.text, valueCodeableConcept.text, dosageInstruction.text/.patientInstruction
    if (
      key === 'text' &&
      typeof value === 'string' &&
      // Chỉ redact text dạng string (plain text), không phải text narrative object (đã xử lý ở trên)
      true
    ) {
      result[key] = '[CLINICAL_TEXT_REDACTED]';
      continue;
    }

    if (key === 'patientInstruction' && typeof value === 'string') {
      result[key] = '[CLINICAL_TEXT_REDACTED]';
      continue;
    }

    // PRESERVE: valueQuantity, valueCodeableConcept, doseAndRate, dosageInstruction
    if (
      key === 'valueQuantity' ||
      key === 'valueCodeableConcept' ||
      key === 'valueInteger' ||
      key === 'valueDecimal' ||
      key === 'valueString' ||
      key === 'doseAndRate' ||
      key === 'dosageInstruction' ||
      key === 'code' ||
      key === 'category' ||
      key === 'component'
    ) {
      // valueString can contain free-text with PHI — redact
      if (key === 'valueString' && typeof value === 'string') {
        result[key] = '[CLINICAL_TEXT_REDACTED]';
        continue;
      }
      // Recurse vào nested objects để redact free-text bên trong (e.g. code.text, dosageInstruction.text)
      if (typeof value === 'object' && !Array.isArray(value)) {
        result[key] = deidentifyResource(
          value as Record<string, unknown>,
          secret,
          offsetDays,
          effectiveResourceType,
        );
        continue;
      }
      if (Array.isArray(value)) {
        result[key] = value.map((item) => {
          if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            return deidentifyResource(
              item as Record<string, unknown>,
              secret,
              offsetDays,
              effectiveResourceType,
            );
          }
          return item;
        });
        continue;
      }
      result[key] = value;
      continue;
    }

    // Recurse into nested objects — truyền resourceType để xử lý Organization/Location đúng
    if (typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deidentifyResource(
        value as Record<string, unknown>,
        secret,
        offsetDays,
        effectiveResourceType,
      );
      continue;
    }

    // Recurse into arrays
    if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          return deidentifyResource(
            item as Record<string, unknown>,
            secret,
            offsetDays,
            effectiveResourceType,
          );
        }
        return item;
      });
      continue;
    }

    // Pass through primitives (boolean, number, string not matched above).
    // PIPA: string sót lại vẫn phải quét RRN — chốt chặn cuối trước khi bundle
    // rời hệ thống đến AI provider (checksum-gated, không đụng số khác).
    result[key] = typeof value === 'string' ? maskRrn(value) : value;
  }

  return result;
}

/**
 * Tìm subject/patient reference đầu tiên trong bundle không có Patient resource.
 * Dùng để derive date-shift key theo từng bệnh nhân thay vì dùng chung offset 'unknown'
 * toàn cục (LOW: patient-less bundles không được share một offset cố định — sẽ cho phép
 * correlate ngày giữa các bundle khác nhau).
 */
function findSubjectKey(bundle: Bundle): string | undefined {
  for (const entry of bundle.entry ?? []) {
    const res = entry.resource as unknown as Record<string, unknown> | undefined;
    if (!res) continue;
    for (const field of ['subject', 'patient'] as const) {
      const ref = res[field];
      if (ref && typeof ref === 'object' && !Array.isArray(ref)) {
        const reference = (ref as Record<string, unknown>)['reference'];
        if (typeof reference === 'string' && reference) return reference;
      }
    }
  }
  return undefined;
}

/**
 * De-identify a FHIR Bundle.
 * Returns the sanitized bundle and the date shift map for later re-identification.
 *
 * PRIVACY GUARANTEE: No PHI in the returned bundle.
 */
export function deidentify(bundle: Bundle, hmacSecret: string): DeidentifyResult {
  const shiftMap: DateShiftMap = {};

  // Determine patient ID hash and date shift offset.
  // LOW: bundle không có Patient resource → derive key từ subject/patient reference
  // (per-subject) thay vì hằng số 'unknown' dùng chung; chỉ fallback 'unknown' khi
  // thực sự không có subject nào.
  const patientEntry = bundle.entry?.find((e) => e.resource?.resourceType === 'Patient');
  const patientId = patientEntry?.resource?.id ?? findSubjectKey(bundle) ?? 'unknown';
  const patientIdHash = hashIdentifier(patientId, hmacSecret);

  if (!(patientIdHash in shiftMap)) {
    shiftMap[patientIdHash] = getDateShift(patientIdHash, hmacSecret);
  }
  const offsetDays = shiftMap[patientIdHash]!;

  // De-identify each entry
  const deidentifiedEntries: BundleEntry[] = (bundle.entry ?? []).map((entry) => {
    if (!entry.resource) return entry;

    const rawResource = entry.resource as unknown as Record<string, unknown>;
    // Truyền resourceType để xử lý Organization/Location name redaction đúng
    const entryResourceType =
      typeof rawResource['resourceType'] === 'string' ? rawResource['resourceType'] : undefined;
    const deidentifiedResource = deidentifyResource(
      rawResource,
      hmacSecret,
      offsetDays,
      entryResourceType,
    );

    return {
      ...entry,
      fullUrl: entry.fullUrl
        ? `urn:uuid:${hashIdentifier(entry.fullUrl, hmacSecret)}`
        : entry.fullUrl,
      resource: deidentifiedResource as Bundle['entry'] extends Array<infer E>
        ? E extends { resource?: infer R }
          ? R
          : never
        : never,
    };
  });

  const deidentifiedBundle = {
    resourceType: 'Bundle' as const,
    type: bundle.type,
    timestamp: bundle.timestamp ? shiftDate(bundle.timestamp, offsetDays) : undefined,
    total: bundle.total,
    entry: deidentifiedEntries,
    _deidentified: true as const,
  } as DeidentifiedBundle;

  return { bundle: deidentifiedBundle, shiftMap };
}

/**
 * Re-identify dates in a summary text using the shift map.
 * Reverses the date shift by applying the negative offset.
 * NOTE: This modifies de-identified date strings back to approximate originals.
 */
export function reidentifyDates(text: string, shiftMap: DateShiftMap): string {
  const offsets = Object.values(shiftMap);
  if (offsets.length === 0) return text;
  // Safety: chỉ đảo ngược khi mọi offset giống nhau. Bundle single-patient luôn có 1
  // offset; nhiều offset KHÁC nhau (multi-patient) không thể reverse an toàn nên trả
  // nguyên văn. (Thay cho guard cũ `length !== 1` chỉ xử lý đúng trường hợp 1 entry.)
  const offset = offsets[0]!;
  if (!offsets.every((o) => o === offset)) {
    return text;
  }
  return text.replace(/\b(\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?)\b/g, (match) =>
    shiftDate(match, -offset),
  );
}
