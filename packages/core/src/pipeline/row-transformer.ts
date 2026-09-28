/**
 * Row → FHIR transformer for CSV/Excel import (canonical ImportMapping).
 *
 * Mỗi dòng sinh tối đa một resource cho mỗi type trong `resourceTypes`:
 *   - Patient: dedupe theo patientId (lần đầu gặp thắng), id xác định theo thứ tự.
 *   - Type khác: chỉ tạo khi ít nhất một cột được map của type đó có giá trị.
 *   - Encounter/Condition/Observation/... .subject → Patient; .encounter → Encounter cùng dòng.
 *   - Default bắt buộc: Encounter.status/class, Observation.status, Condition.clinicalStatus...
 *   - Mọi resource được validate bằng validator của repo; resource lỗi bị bỏ (kèm issue).
 *
 * PIPA: RRN (주민등록번호) trong bất kỳ ô nào không bao giờ ra output dạng raw —
 * ở identifier thì HMAC-hash (nếu có secret) hoặc mask, ở field khác thì mask.
 * Issue messages không bao giờ chứa giá trị ô (no PHI) — chỉ row/column/field.
 */

import { createHash } from 'node:crypto';

import type {
  Bundle,
  FhirPathSegment,
  FieldMapping,
  ImportMapping,
  Resource,
} from '@fhirbridge/types';

import { hashIdentifier } from '../ai/deidentifier.js';
import type { SourceRow } from '../connectors/his-connector-interface.js';
import { BundleBuilder } from '../bundle/bundle-builder.js';
import {
  ALLERGY_CLINICAL_SYSTEM,
  ALLERGY_VER_STATUS_SYSTEM,
  CONDITION_CATEGORY_SYSTEM,
  CONDITION_CLINICAL_SYSTEM,
  CONDITION_VER_STATUS_SYSTEM,
  HL7_ACT_CODE_SYSTEM,
  OBSERVATION_CATEGORY_SYSTEM,
  V3_NULL_FLAVOR_SYSTEM,
} from '../coding/code-systems.js';
import {
  REQUIRED_CODE_BINDINGS,
  formatSegments,
  resolveFieldPath,
  type PrimitiveKind,
} from '../connectors/mapping/fhir-element-model.js';
import {
  cellToText,
  compileDateFormat,
  parseBoolean,
  parseDateValue,
  parseNumber,
  toFhirDate,
  toFhirDateTime,
  type CompiledDateFormat,
} from '../connectors/mapping/value-transforms.js';
import { containsRrn, maskRrn } from '../security/rrn-detector.js';
import { patterns, validateResource } from '../validators/resource-validator.js';
import { validatePatient } from '../validators/patient-validator.js';

/** One source row. `rowNumber` is 1-based in the source file (header = row 1). */
export type TabularRow = SourceRow;

/** A non-fatal problem found while importing. Never contains cell values. */
export interface ImportIssue {
  severity: 'warning' | 'error';
  row?: number;
  sheet?: string;
  /** Mapping key, e.g. "Patient.birthDate" */
  field?: string;
  column?: string;
  message: string;
}

export interface TransformedResource {
  fullUrl: string;
  resource: Resource;
}

export interface ImportStats {
  rowsRead: number;
  rowsSkipped: number;
  resourcesByType: Record<string, number>;
  resourcesDropped: number;
  /** Cells whose RRN was hashed (with secret) or masked */
  rrnValuesProtected: number;
}

export interface RowTransformerOptions {
  /** HMAC secret: RRN in identifier columns are hashed (else masked) */
  rrnSecret?: string;
  /**
   * Mixed into deterministic ids so different source files never share ids
   * (importTabularFile dùng sha256 nội dung file). Default "fhirbridge-import".
   */
  idNamespace?: string;
}

/** v3 ActEncounterCode — the extensible value set for Encounter.class. */
const ACT_ENCOUNTER_CODES = new Set([
  'AMB',
  'EMER',
  'FLD',
  'HH',
  'IMP',
  'ACUTE',
  'NONAC',
  'OBSENC',
  'PRENC',
  'SS',
  'VR',
]);

/** Coded elements whose codings default to a well-known system when the mapping gives none. */
const DEFAULT_CODING_SYSTEMS: Readonly<Record<string, string>> = {
  'Encounter.class': HL7_ACT_CODE_SYSTEM,
  'Condition.clinicalStatus': CONDITION_CLINICAL_SYSTEM,
  'Condition.verificationStatus': CONDITION_VER_STATUS_SYSTEM,
  'Condition.category': CONDITION_CATEGORY_SYSTEM,
  'Observation.category': OBSERVATION_CATEGORY_SYSTEM,
  'AllergyIntolerance.clinicalStatus': ALLERGY_CLINICAL_SYSTEM,
  'AllergyIntolerance.verificationStatus': ALLERGY_VER_STATUS_SYSTEM,
};

/** Types other rows' resources hang off (their shared columns still create them). */
const CONTEXT_TYPES = new Set(['Patient', 'Encounter']);

/** Resource types that reference the patient via `patient` instead of `subject`. */
const PATIENT_REFERENCE_ELEMENT: Readonly<Record<string, string>> = {
  AllergyIntolerance: 'patient',
};

interface FieldInfo {
  field: FieldMapping;
  kind: PrimitiveKind;
  bindingKey: string;
  format?: CompiledDateFormat;
}

interface Leaf {
  segments: FhirPathSegment[];
  value: unknown;
  fromColumn: boolean;
  /** Column value that may create the resource (not a column shared with another type) */
  triggers: boolean;
}

interface PatientState {
  id: string;
  ok: boolean;
  firstRow: number;
}

type Json = Record<string, unknown>;

/** Deterministic UUID (v4-shaped so it passes the repo's urn:uuid validator). */
export function deterministicUuid(input: string): string {
  const h = createHash('sha256').update(input).digest();
  h[6] = (h[6]! & 0x0f) | 0x40;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Human-readable one-line rendering of an ImportIssue (no PHI). */
export function formatImportIssue(issue: ImportIssue): string {
  const where: string[] = [];
  if (issue.row !== undefined) where.push(`row ${issue.row}`);
  if (issue.sheet) where.push(`sheet "${issue.sheet}"`);
  if (issue.field) where.push(`field "${issue.field}"`);
  if (issue.column) where.push(`column "${issue.column}"`);
  return where.length > 0 ? `${where.join(', ')}: ${issue.message}` : issue.message;
}

/**
 * Stateful transformer: feed rows in order; Patients are deduplicated across
 * all rows fed to the same instance.
 */
export class RowTransformer {
  private readonly fieldsByType = new Map<string, FieldInfo[]>();
  /** Per type: columns whose value creates the resource (see constructor) */
  private readonly triggerColumns = new Map<string, Set<string>>();
  private readonly patients = new Map<string, PatientState>();
  private readonly warned = new Set<string>();
  private readonly namespace: string;
  private readonly patientIdentifierMerged: boolean;
  private patientOrdinal = 0;
  private readonly stats: ImportStats = {
    rowsRead: 0,
    rowsSkipped: 0,
    resourcesByType: {},
    resourcesDropped: 0,
    rrnValuesProtected: 0,
  };

  constructor(
    private readonly mapping: ImportMapping,
    private readonly options: RowTransformerOptions = {},
  ) {
    this.namespace = options.idNamespace ?? 'fhirbridge-import';

    for (const field of mapping.fields) {
      const resolved = resolveFieldPath(field.resourceType, field.path);
      if (typeof resolved === 'string') {
        // parseMappingConfig đã validate — chỉ xảy ra nếu ImportMapping bị dựng tay sai.
        throw new Error(`Invalid mapping field "${field.key}": ${resolved}`);
      }
      const info: FieldInfo = { field, kind: resolved.kind, bindingKey: resolved.bindingKey };
      if (field.source.kind === 'column' && field.source.format) {
        const compiled = compileDateFormat(field.source.format);
        if (typeof compiled === 'string')
          throw new Error(`Invalid format in "${field.key}": ${compiled}`);
        info.format = compiled;
      }
      const list = this.fieldsByType.get(field.resourceType) ?? [];
      list.push(info);
      this.fieldsByType.set(field.resourceType, list);
    }

    // Cột dùng chung là "ngữ cảnh": vd ngày khám → Encounter.period.start và
    // Observation.effectiveDateTime tạo Encounter, không tạo Observation rỗng.
    // Patient/Encounter (context type) vẫn tính cột dùng chung với type con;
    // type con không tính cột dùng chung nào. Type không còn cột nào → tính tất cả.
    const typesByColumn = new Map<string, Set<string>>();
    for (const f of mapping.fields) {
      if (f.source.kind !== 'column') continue;
      const set = typesByColumn.get(f.source.column) ?? new Set<string>();
      set.add(f.resourceType);
      typesByColumn.set(f.source.column, set);
    }
    for (const [type, infos] of this.fieldsByType) {
      const columns = infos.flatMap(({ field }) =>
        field.source.kind === 'column' ? [field.source.column] : [],
      );
      const own = columns.filter((c) => {
        const others = [...typesByColumn.get(c)!].filter((t) => t !== type);
        if (others.length === 0) return true;
        return CONTEXT_TYPES.has(type) && !others.some((t) => CONTEXT_TYPES.has(t));
      });
      this.triggerColumns.set(type, new Set(own.length > 0 ? own : columns));
    }

    // Patient.identifier[i].value lấy từ cột patientId → gộp làm một identifier (gắn system).
    const pid = mapping.patientId;
    const patientFields = this.fieldsByType.get('Patient') ?? [];
    const merged = pid
      ? patientFields.find(
          ({ field }) =>
            /^identifier\[\d\]\.value$/.test(field.path) &&
            field.source.kind === 'column' &&
            field.source.column === pid.column,
        )
      : undefined;
    this.patientIdentifierMerged = merged !== undefined;
    if (merged && pid?.system) {
      const systemPath = merged.field.path.replace(/\.value$/, '.system');
      if (!patientFields.some(({ field }) => field.path === systemPath)) {
        const segments: FhirPathSegment[] = [
          ...merged.field.segments.slice(0, -1),
          { name: 'system' },
        ];
        // Chèn trước field value → identifier xuất {system, value} đúng thứ tự
        patientFields.splice(patientFields.indexOf(merged), 0, {
          field: {
            key: 'patientId.system',
            resourceType: 'Patient',
            path: systemPath,
            segments,
            source: { kind: 'literal', value: pid.system },
          },
          kind: 'uri',
          bindingKey: 'Identifier.system',
        });
      }
    }
  }

  /** Counters so far (copy). */
  getStats(): ImportStats {
    return { ...this.stats, resourcesByType: { ...this.stats.resourcesByType } };
  }

  /**
   * Transform one row.
   * @param types - resource types this row may produce (multi-sheet Excel: the
   *   types mapped to the row's sheet). Defaults to all `resourceTypes`.
   */
  transformRow(
    row: TabularRow,
    types: readonly string[] = this.mapping.resourceTypes,
  ): { resources: TransformedResource[]; issues: ImportIssue[] } {
    this.stats.rowsRead++;
    const issues: ImportIssue[] = [];
    const resources: TransformedResource[] = [];
    const protectedColumns = new Set<string>();
    const at = { row: row.rowNumber, ...(row.sheet ? { sheet: row.sheet } : {}) };
    const issue = (
      severity: ImportIssue['severity'],
      message: string,
      extra: Partial<ImportIssue> = {},
    ) => issues.push({ severity, ...at, ...extra, message });

    // ── Patient key ─────────────────────────────────────────────────────────
    const pid = this.mapping.patientId;
    let patientKey: string;
    let patientIdValue: string | undefined;
    if (pid) {
      const raw = row.values[pid.column];
      patientIdValue = raw === undefined || raw === null ? '' : cellToText(raw);
      if (!patientIdValue) {
        this.stats.rowsSkipped++;
        issue('warning', 'patientId column is empty — row skipped', { column: pid.column });
        return { resources, issues };
      }
      patientKey = `id:${patientIdValue}`;
    } else {
      patientKey = `row:${row.sheet ?? ''}:${row.rowNumber}`;
    }

    const producesPatient = this.mapping.resourceTypes.includes('Patient');
    let patientRef: Json | undefined;
    let patientState = this.patients.get(patientKey);

    // ── Patient (dedupe) ────────────────────────────────────────────────────
    if (producesPatient && types.includes('Patient') && !patientState) {
      const leaves = this.buildLeaves('Patient', row, issue, protectedColumns);
      const hasData = leaves.some((l) => l.fromColumn) || patientIdValue !== undefined;
      if (hasData) {
        const id = deterministicUuid(`${this.namespace}|Patient|${++this.patientOrdinal}`);
        const patient: Json = { resourceType: 'Patient', id, ...assemble(leaves) };
        if (pid && patientIdValue !== undefined && !this.patientIdentifierMerged) {
          const identifier: Json = {
            ...(pid.system ? { system: pid.system } : {}),
            value: this.protectIdentifier(patientIdValue, pid.column, protectedColumns),
          };
          patient['identifier'] = [identifier, ...((patient['identifier'] as Json[]) ?? [])];
        }
        patientState = { id, ok: true, firstRow: row.rowNumber };
        this.patients.set(patientKey, patientState);
        if (this.accept(patient, 'Patient', issue)) {
          resources.push({ fullUrl: `urn:uuid:${id}`, resource: patient as unknown as Resource });
        } else {
          patientState.ok = false;
        }
      }
    }

    if (producesPatient) {
      if (patientState) {
        patientRef = { reference: `urn:uuid:${patientState.id}` };
      } else if (pid && patientIdValue !== undefined) {
        // Patient nằm ở sheet khác và không tìm thấy → logical reference theo identifier.
        patientRef = this.logicalPatientRef(patientIdValue, protectedColumns);
        issue(
          'warning',
          'patient not found among Patient rows — referenced by identifier instead',
          { column: pid.column },
        );
      }
    } else if (pid && patientIdValue !== undefined) {
      patientRef = this.logicalPatientRef(patientIdValue, protectedColumns);
    }

    // ── Other resource types ───────────────────────────────────────────────
    let encounterRef: Json | undefined;
    const ordered = this.mapping.resourceTypes.filter((t) => t !== 'Patient' && types.includes(t));
    for (const type of ordered) {
      const leaves = this.buildLeaves(type, row, issue, protectedColumns);
      if (!leaves.some((l) => l.triggers)) continue;

      if (patientState && !patientState.ok) {
        this.stats.resourcesDropped++;
        issue(
          'error',
          `${type} skipped: its Patient (first seen on row ${patientState.firstRow}) failed validation`,
        );
        continue;
      }
      if (!patientRef) {
        this.stats.resourcesDropped++;
        issue('error', `${type} skipped: row has no Patient data to reference`);
        continue;
      }

      const id = deterministicUuid(`${this.namespace}|${type}|${row.sheet ?? ''}|${row.rowNumber}`);
      // Default đặt trước để key order dễ đọc (status đầu); giá trị map được ghi đè.
      const resource: Json = { resourceType: type, id, ...headDefaults(type), ...assemble(leaves) };
      applyDefaults(resource, type);
      resource[PATIENT_REFERENCE_ELEMENT[type] ?? 'subject'] = patientRef;
      if (type !== 'Encounter' && encounterRef) resource['encounter'] = encounterRef;
      if (type === 'Condition' && encounterRef && resource['category'] === undefined) {
        resource['category'] = [
          {
            coding: [
              {
                system: CONDITION_CATEGORY_SYSTEM,
                code: 'encounter-diagnosis',
                display: 'Encounter Diagnosis',
              },
            ],
          },
        ];
      }

      if (this.accept(resource, type, issue)) {
        resources.push({ fullUrl: `urn:uuid:${id}`, resource: resource as unknown as Resource });
        if (type === 'Encounter') encounterRef = { reference: `urn:uuid:${id}` };
      }
    }

    this.stats.rrnValuesProtected += protectedColumns.size;
    for (const { resource } of resources) {
      const t = resource.resourceType;
      this.stats.resourcesByType[t] = (this.stats.resourcesByType[t] ?? 0) + 1;
    }
    return { resources, issues };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Validate with the repo's validators; on error record an issue and drop. */
  private accept(
    resource: Json,
    type: string,
    issue: (s: ImportIssue['severity'], m: string, e?: Partial<ImportIssue>) => void,
  ): boolean {
    const result = type === 'Patient' ? validatePatient(resource) : validateResource(resource);
    const errors = result.errors.filter((e) => e.severity === 'error');
    if (errors.length === 0) return true;
    this.stats.resourcesDropped++;
    issue('error', `${type} dropped — ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    return false;
  }

  private logicalPatientRef(value: string, protectedColumns: Set<string>): Json {
    const pid = this.mapping.patientId!;
    return {
      identifier: {
        ...(pid.system ? { system: pid.system } : {}),
        value: this.protectIdentifier(value, pid.column, protectedColumns),
      },
    };
  }

  /** RRN guard for identifier values: hash with secret, else mask. */
  private protectIdentifier(value: string, column: string, protectedColumns: Set<string>): string {
    if (!containsRrn(value)) return value;
    protectedColumns.add(column);
    return this.options.rrnSecret
      ? hashIdentifier(value.trim(), this.options.rrnSecret)
      : maskRrn(value);
  }

  private buildLeaves(
    type: string,
    row: TabularRow,
    issue: (s: ImportIssue['severity'], m: string, e?: Partial<ImportIssue>) => void,
    protectedColumns: Set<string>,
  ): Leaf[] {
    const leaves: Leaf[] = [];
    for (const info of this.fieldsByType.get(type) ?? []) {
      const { field } = info;
      if (field.source.kind === 'literal') {
        const coerced = coerce(info, field.source.value, this.mapping.timezone);
        if (coerced.ok) {
          leaves.push({
            segments: field.segments,
            value: coerced.value,
            fromColumn: false,
            triggers: false,
          });
        }
        continue;
      }
      const value = this.readColumn(info, row, issue, protectedColumns);
      if (value !== undefined) {
        const triggers = this.triggerColumns.get(type)?.has(field.source.column) ?? true;
        leaves.push({ segments: field.segments, value, fromColumn: true, triggers });
      }
    }
    return leaves;
  }

  /** Read one mapped cell: RRN guard → valueMap → transform → type coercion. */
  private readColumn(
    info: FieldInfo,
    row: TabularRow,
    issue: (s: ImportIssue['severity'], m: string, e?: Partial<ImportIssue>) => void,
    protectedColumns: Set<string>,
  ): unknown {
    const { field } = info;
    if (field.source.kind !== 'column') return undefined;
    const { column, valueMap, transform } = field.source;
    const raw = row.values[column];
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === 'string' && raw.trim() === '') return undefined;
    const where = { field: field.key, column };

    let value: unknown = raw;

    // PIPA: RRN không bao giờ đi tiếp dạng raw.
    if (typeof raw === 'string' && containsRrn(raw)) {
      protectedColumns.add(column);
      const isIdentifier = field.segments.some((s) => s.name === 'identifier');
      if (isIdentifier && this.options.rrnSecret) {
        return hashIdentifier(raw.trim(), this.options.rrnSecret);
      }
      value = maskRrn(raw);
    }

    if (valueMap && !(value instanceof Date)) {
      const text = cellToText(value);
      const mapped =
        valueMap[text] ??
        Object.entries(valueMap).find(([k]) => k.toLowerCase() === text.toLowerCase())?.[1];
      if (mapped !== undefined) value = mapped;
    }

    switch (transform) {
      case 'lowercase':
        value = cellToText(value).toLowerCase();
        break;
      case 'uppercase':
        value = cellToText(value).toUpperCase();
        break;
      case 'trim':
        value = cellToText(value);
        break;
      case 'number': {
        const n = parseNumber(value);
        if (n === undefined) {
          issue('warning', 'value is not a number — field omitted', where);
          return undefined;
        }
        value = n;
        break;
      }
      case 'date':
      case 'datetime': {
        const parts = parseDateValue(value, info.format);
        if (typeof parts === 'string') {
          issue('warning', `${parts} — field omitted`, where);
          return undefined;
        }
        if (transform === 'date') {
          value = toFhirDate(parts);
        } else {
          const { value: dt, timeDropped } = toFhirDateTime(parts, this.mapping.timezone);
          if (timeDropped) this.warnTimeDropped(field.key, issue);
          value = dt;
        }
        break;
      }
      default:
        break;
    }

    const coerced = coerce(info, value, this.mapping.timezone);
    if (!coerced.ok) {
      issue('warning', `${coerced.error} — field omitted`, where);
      return undefined;
    }
    if (coerced.timeDropped) this.warnTimeDropped(field.key, issue);

    const result = coerced.value;
    if (
      field.resourceType === 'Encounter' &&
      field.path === 'class.code' &&
      typeof result === 'string'
    ) {
      if (!ACT_ENCOUNTER_CODES.has(result) && !this.warned.has(`class:${field.key}`)) {
        this.warned.add(`class:${field.key}`);
        issue(
          'warning',
          `Encounter.class code is not a v3-ActCode encounter code (expected one of ${[...ACT_ENCOUNTER_CODES].join(', ')}) — add a "valueMap" (reported once)`,
          where,
        );
      }
    }
    return result;
  }

  private warnTimeDropped(
    key: string,
    issue: (s: ImportIssue['severity'], m: string, e?: Partial<ImportIssue>) => void,
  ): void {
    if (this.warned.has(`tz:${key}`)) return;
    this.warned.add(`tz:${key}`);
    issue(
      'warning',
      'datetime has a time but no UTC offset and the mapping sets no "timezone" — emitted as a date only (reported once per field; set "timezone", e.g. "+07:00")',
      { field: key },
    );
  }
}

type Coerced = { ok: true; value: unknown; timeDropped?: boolean } | { ok: false; error: string };

const ok = (value: unknown): Coerced => ({ ok: true, value });
const fail = (error: string): Coerced => ({ ok: false, error });

/** Coerce a (transformed) value to the element's FHIR primitive type. */
function coerce(info: FieldInfo, value: unknown, timezone?: string): Coerced {
  switch (info.kind) {
    case 'decimal':
    case 'integer': {
      const n = parseNumber(value);
      if (n === undefined) return fail('value is not a number');
      if (info.kind === 'integer' && !Number.isInteger(n)) return fail('value is not an integer');
      return ok(n);
    }
    case 'boolean': {
      const b = parseBoolean(value);
      return b === undefined ? fail('value is not a boolean (true/false/yes/no/1/0)') : ok(b);
    }
    case 'date': {
      if (typeof value === 'string' && patterns.DATE.test(value)) return ok(value);
      const parts = parseDateValue(value);
      return typeof parts === 'string' ? fail(parts) : ok(toFhirDate(parts));
    }
    case 'dateTime': {
      if (typeof value === 'string' && patterns.DATETIME.test(value)) return ok(value);
      const parts = parseDateValue(value);
      if (typeof parts === 'string') return fail(parts);
      const { value: dt, timeDropped } = toFhirDateTime(parts, timezone);
      return { ok: true, value: dt, timeDropped };
    }
    case 'code': {
      const code = cellToText(value).replace(/\s+/g, ' ');
      if (!code) return fail('empty code');
      const allowed = REQUIRED_CODE_BINDINGS[info.bindingKey];
      if (allowed && !allowed.includes(code)) {
        return fail(
          `value is not a valid ${info.bindingKey} code (allowed: ${allowed.join(', ')}; map source values with "valueMap")`,
        );
      }
      return ok(code);
    }
    case 'uri': {
      const uri = cellToText(value);
      return !uri || /\s/.test(uri) ? fail('value is not a valid URI') : ok(uri);
    }
    case 'string':
    default: {
      const text =
        typeof value === 'number' || typeof value === 'boolean' ? String(value) : cellToText(value);
      return text === '' ? fail('empty value') : ok(text);
    }
  }
}

/**
 * Build the nested FHIR object from leaves.
 * Literal leaves are kept only when their element (nearest enclosing array
 * item, else the top-level element) also received a column value in this row —
 * vd `coding[].system` literal chỉ xuất hiện khi `coding[].code` có giá trị.
 */
function assemble(leaves: Leaf[]): Json {
  const covered = new Set<string>();
  for (const leaf of leaves) {
    if (!leaf.fromColumn) continue;
    for (let i = 0; i < leaf.segments.length - 1; i++) {
      covered.add(formatSegments(leaf.segments.slice(0, i + 1)));
    }
  }

  const root: Json = {};
  for (const leaf of leaves) {
    if (!leaf.fromColumn && leaf.segments.length > 1) {
      let anchor = 0;
      for (let i = 0; i < leaf.segments.length - 1; i++) {
        if (leaf.segments[i]!.index !== undefined) anchor = i;
      }
      if (!covered.has(formatSegments(leaf.segments.slice(0, anchor + 1)))) continue;
    }
    setPath(root, leaf.segments, leaf.value);
  }
  compact(root);
  return root;
}

function setPath(root: Json, segments: FhirPathSegment[], value: unknown): void {
  let node: Json = root;
  segments.forEach((seg, i) => {
    const last = i === segments.length - 1;
    if (seg.index === undefined) {
      if (last) {
        node[seg.name] = value;
      } else {
        node = (node[seg.name] ??= {}) as Json;
      }
      return;
    }
    const arr = (node[seg.name] ??= []) as unknown[];
    if (last) {
      arr[seg.index] = value;
    } else {
      node = (arr[seg.index] ??= {}) as Json;
    }
  });
}

/** Remove array holes (e.g. only identifier[1] had data) and codings without a code. */
function compact(node: Json): void {
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      const kept = value.filter((v) => {
        if (v === undefined || v === null) return false;
        if (typeof v !== 'object') return true;
        compact(v as Json);
        if (key === 'coding' && (v as Json)['code'] === undefined) return false;
        return Object.keys(v as Json).length > 0;
      });
      if (kept.length === 0) delete node[key];
      else node[key] = kept;
    } else if (typeof value === 'object' && value !== null) {
      compact(value as Json);
      if (Object.keys(value).length === 0) delete node[key];
    }
  }
}

/** Required-element defaults (overridden by mapped values). */
function headDefaults(type: string): Json {
  switch (type) {
    case 'Encounter':
      return { status: 'finished' };
    case 'Condition':
      return {
        clinicalStatus: { coding: [{ system: CONDITION_CLINICAL_SYSTEM, code: 'active' }] },
      };
    case 'Observation':
      return { status: 'final' };
    case 'Procedure':
      return { status: 'completed' };
    case 'AllergyIntolerance':
      return { clinicalStatus: { coding: [{ system: ALLERGY_CLINICAL_SYSTEM, code: 'active' }] } };
    default:
      return {};
  }
}

/** Default coding systems + Encounter.class fallback. */
function applyDefaults(resource: Json, type: string): void {
  const withSystem = (coding: Json, system: string): Json =>
    coding['system'] === undefined ? { system, ...coding } : coding;

  for (const [key, system] of Object.entries(DEFAULT_CODING_SYSTEMS)) {
    const [owner, element] = key.split('.') as [string, string];
    const target = resource[element];
    if (owner !== type || target === undefined) continue;
    if (element === 'class') {
      // Encounter.class là Coding (R4); các element khác là CodeableConcept
      resource[element] = withSystem(target as Json, system);
      continue;
    }
    for (const concept of Array.isArray(target) ? (target as Json[]) : [target as Json]) {
      const codings = concept['coding'] as Json[] | undefined;
      if (codings) concept['coding'] = codings.map((c) => withSystem(c, system));
    }
  }

  if (type === 'Encounter' && (resource['class'] as Json | undefined)?.['code'] === undefined) {
    // class bắt buộc (1..1): không có dữ liệu → NullFlavor UNK thay vì đoán AMB
    resource['class'] = { system: V3_NULL_FLAVOR_SYSTEM, code: 'UNK', display: 'unknown' };
  }
}

/**
 * Convenience: transform an in-memory list of rows into a collection Bundle.
 * (File import: importTabularFile.)
 */
export function transformRows(
  mapping: ImportMapping,
  rows: Iterable<TabularRow>,
  options: RowTransformerOptions = {},
): { bundle: Bundle; issues: ImportIssue[]; stats: ImportStats } {
  const transformer = new RowTransformer(mapping, options);
  const builder = new BundleBuilder();
  const issues: ImportIssue[] = [];
  for (const row of rows) {
    const out = transformer.transformRow(row);
    for (const r of out.resources) builder.addResourceWithUrl(r.resource, r.fullUrl);
    issues.push(...out.issues);
  }
  return { bundle: builder.build(), issues, stats: transformer.getStats() };
}
