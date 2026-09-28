/**
 * parseMappingConfig — một loader duy nhất cho column-mapping CSV/Excel.
 *
 * Canonical format ("fields", xem examples/column-mappings/mapping.schema.json):
 *   { patientId, sheet, timezone, resourceTypes, fields: { "<Type>.<path>": spec } }
 *
 * Legacy formats vẫn được nhận và chuẩn hoá về canonical:
 *   - { mappings: ColumnMapping[] }  (packages/types mapping-config.ts)
 *   - { columns: ColumnMapping[] }   (API cũ) hoặc mảng ColumnMapping[] trần
 *   - flat { "<column>": "<fhirPath>" } (CLI cũ; path không prefix → defaultResourceType)
 *
 * Mọi lỗi được gom lại (không dừng ở lỗi đầu) và nêu rõ key nào sai, sai gì.
 */

import type {
  CodeMapping,
  FieldMapping,
  FieldSource,
  FieldTransform,
  ImportMapping,
} from '@fhirbridge/types';

import {
  AUTO_REFERENCE_ELEMENTS,
  REQUIRED_CODE_BINDINGS,
  SUPPORTED_RESOURCE_TYPES,
  formatSegments,
  resolveFieldPath,
} from './fhir-element-model.js';
import { TIMEZONE_RE, compileDateFormat, parseBoolean, parseNumber } from './value-transforms.js';

/** Thrown by parseMappingConfig; `issues` lists every problem found. */
export class MappingConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      issues.length === 1
        ? `Invalid column mapping: ${issues[0]}`
        : `Invalid column mapping (${issues.length} problems):\n  - ${issues.join('\n  - ')}`,
    );
    this.name = 'MappingConfigError';
    this.issues = issues;
  }
}

export interface ParseMappingOptions {
  /** Resource type for unprefixed paths in the legacy flat format (default "Patient"). */
  defaultResourceType?: string;
}

/** Transforms accepted in the canonical format. */
export const FIELD_TRANSFORMS: readonly FieldTransform[] = [
  'lowercase',
  'uppercase',
  'trim',
  'date',
  'datetime',
  'number',
];

const CANONICAL_TOP_LEVEL_KEYS = [
  'description',
  'patientId',
  'sheet',
  'timezone',
  'resourceTypes',
  'fields',
];
const COLUMN_SPEC_KEYS = ['column', 'transform', 'format', 'valueMap'];
const FORMAT_HINT =
  'Expected the canonical format {"fields": {"Patient.name.family": "LAST_NAME", ...}} — see examples/column-mappings/*.json';

/** Types whose rows need a patient to reference. */
const NEEDS_PATIENT = new Set(Object.keys(AUTO_REFERENCE_ELEMENTS));

/** Intermediate field before validation (canonical spec + where it came from). */
interface RawField {
  /** Label used in error messages, e.g. `fields["Patient.gender"]` or `mappings[2]` */
  label: string;
  key: string;
  spec: unknown;
}

interface Draft {
  fields: RawField[];
  patientId?: unknown;
  sheet?: unknown;
  timezone?: unknown;
  resourceTypes?: unknown;
  description?: string;
  notices: string[];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const describeType = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

const quote = (s: string) => JSON.stringify(s);

/**
 * Validate and normalize a column mapping (object or JSON text) in any accepted format.
 * @throws MappingConfigError with every problem found
 */
export function parseMappingConfig(
  input: unknown,
  options: ParseMappingOptions = {},
): ImportMapping {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (err) {
      throw new MappingConfigError([`mapping is not valid JSON: ${(err as Error).message}`]);
    }
  }

  const issues: string[] = [];
  let draft: Draft;
  let sourceFormat: ImportMapping['sourceFormat'];

  if (Array.isArray(value)) {
    sourceFormat = 'columns';
    draft = fromLegacyEntries(value, 'mapping', issues);
  } else if (!isPlainObject(value)) {
    throw new MappingConfigError([
      `mapping must be a JSON object, got ${describeType(value)}. ${FORMAT_HINT}`,
    ]);
  } else if ('fields' in value) {
    if ('mappings' in value || 'columns' in value) {
      throw new MappingConfigError([
        'mapping mixes the canonical "fields" format with a legacy "mappings"/"columns" list — use only "fields"',
      ]);
    }
    sourceFormat = 'fields';
    draft = fromCanonical(value, issues);
  } else if (Array.isArray(value['mappings']) || Array.isArray(value['columns'])) {
    const listKey = Array.isArray(value['mappings']) ? 'mappings' : 'columns';
    sourceFormat = listKey;
    draft = fromLegacyEntries(value[listKey] as unknown[], listKey, issues);
    if (typeof value['description'] === 'string') draft.description = value['description'];
  } else {
    sourceFormat = 'flat';
    draft = fromFlat(value, options.defaultResourceType ?? 'Patient', issues);
  }

  if (issues.length > 0) throw new MappingConfigError(issues);

  const mapping = buildMapping(draft, sourceFormat, issues);
  if (issues.length > 0) throw new MappingConfigError(issues);
  return mapping;
}

// ── Format readers ───────────────────────────────────────────────────────────

function fromCanonical(doc: Record<string, unknown>, issues: string[]): Draft {
  for (const key of Object.keys(doc)) {
    if (!key.startsWith('$') && !CANONICAL_TOP_LEVEL_KEYS.includes(key)) {
      issues.push(
        `unknown top-level key ${quote(key)} (allowed: $schema, ${CANONICAL_TOP_LEVEL_KEYS.join(', ')})`,
      );
    }
  }
  if (doc['description'] !== undefined && typeof doc['description'] !== 'string') {
    issues.push(`"description" must be a string, got ${describeType(doc['description'])}`);
  }

  const fields: RawField[] = [];
  const rawFields = doc['fields'];
  if (!isPlainObject(rawFields)) {
    issues.push(
      `"fields" must be an object of "<ResourceType>.<path>": spec, got ${describeType(rawFields)}`,
    );
  } else if (Object.keys(rawFields).length === 0) {
    issues.push('"fields" is empty — map at least one column');
  } else {
    for (const [key, spec] of Object.entries(rawFields)) {
      fields.push({ label: `fields[${quote(key)}]`, key, spec });
    }
  }

  return {
    fields,
    patientId: doc['patientId'],
    sheet: doc['sheet'],
    timezone: doc['timezone'],
    resourceTypes: doc['resourceTypes'],
    description: typeof doc['description'] === 'string' ? doc['description'] : undefined,
    notices: [],
  };
}

function fromFlat(doc: Record<string, unknown>, defaultType: string, issues: string[]): Draft {
  const draft: Draft = { fields: [], notices: [] };
  const entries = Object.entries(doc).filter(([k]) => !k.startsWith('$') && k !== 'description');
  if (entries.length === 0) {
    issues.push(`mapping has no fields. ${FORMAT_HINT}`);
    return draft;
  }
  for (const [column, path] of entries) {
    if (typeof path !== 'string' || path.trim() === '') {
      issues.push(
        `unrecognized mapping format: key ${quote(column)} has a ${describeType(path)} value. ${FORMAT_HINT} (legacy flat mappings must map "<column>": "<fhirPath>" strings)`,
      );
      continue;
    }
    const target = withResourceType(path.trim(), defaultType);
    if (isResourceIdPath(target)) {
      claimPatientIdColumn(draft, column, target, `flat mapping ${quote(column)}`);
      continue;
    }
    draft.fields.push({ label: `flat mapping ${quote(column)}`, key: target, spec: column });
  }
  if (draft.fields.length > 0 || draft.patientId) {
    draft.notices.push(
      'legacy flat {"<column>": "<fhirPath>"} mapping was converted to the canonical "fields" format',
    );
  }
  return draft;
}

function fromLegacyEntries(entries: unknown[], label: string, issues: string[]): Draft {
  const draft: Draft = { fields: [], notices: [] };
  if (entries.length === 0) {
    issues.push(`"${label}" is empty — map at least one column`);
    return draft;
  }

  entries.forEach((entry, i) => {
    const at = `${label}[${i}]`;
    if (!isPlainObject(entry)) {
      issues.push(
        `${at} must be an object {sourceColumn, fhirPath, resourceType}, got ${describeType(entry)}`,
      );
      return;
    }
    const { sourceColumn, fhirPath, resourceType, transform, codeSystem, valueMappings } = entry;
    let ok = true;
    for (const [name, v] of Object.entries({ sourceColumn, fhirPath, resourceType })) {
      if (typeof v !== 'string' || v.trim() === '') {
        issues.push(`${at}.${name} must be a non-empty string`);
        ok = false;
      }
    }
    if (
      transform !== undefined &&
      !['date', 'code', 'string', 'number'].includes(transform as string)
    ) {
      issues.push(
        `${at}.transform: unknown legacy transform ${quote(String(transform))} (allowed: date, code, string, number)`,
      );
      ok = false;
    }
    if (codeSystem !== undefined && typeof codeSystem !== 'string') {
      issues.push(`${at}.codeSystem must be a string URI`);
      ok = false;
    }
    const codes = parseLegacyValueMappings(valueMappings, at, issues);
    if (!ok || codes === null) return;

    const type = (resourceType as string).trim();
    const column = (sourceColumn as string).trim();
    const target = withResourceType((fhirPath as string).trim(), type);
    if (isResourceIdPath(target)) {
      claimPatientIdColumn(draft, column, target, at);
      return;
    }

    const useCodes = transform === 'code' && codes.length > 0;
    const path = target.slice(type.length + 1);
    const shape = legacyTargetShape(type, path);

    if (shape === 'CodeableConcept' || shape === 'Coding') {
      // Legacy wrapInCodeableConcept → coding[0].code/system (+ text)
      const codingPrefix = shape === 'CodeableConcept' ? `${target}.coding[]` : target;
      const system = typeof codeSystem === 'string' ? codeSystem : commonSystem(codes);
      draft.fields.push({
        label: at,
        key: `${codingPrefix}.code`,
        spec: useCodes ? { column, valueMap: codeMap(codes, 'code') } : column,
      });
      if (system)
        draft.fields.push({ label: at, key: `${codingPrefix}.system`, spec: { literal: system } });
      if (shape === 'CodeableConcept') {
        draft.fields.push({
          label: at,
          key: `${target}.text`,
          spec: useCodes ? { column, valueMap: codeMap(codes, 'display') } : column,
        });
      }
      return;
    }

    if (typeof codeSystem === 'string') {
      draft.notices.push(`${at}: codeSystem is ignored for primitive element ${target}`);
    }
    const spec: Record<string, unknown> = { column };
    if (transform === 'date') spec['transform'] = 'date';
    if (transform === 'number') spec['transform'] = 'number';
    if (transform === 'string') spec['transform'] = 'trim';
    if (useCodes) spec['valueMap'] = codeMap(codes, 'code');
    draft.fields.push({ label: at, key: target, spec });
  });

  if (draft.fields.length > 0 || draft.patientId) {
    draft.notices.push(`legacy "${label}" list was converted to the canonical "fields" format`);
  }
  return draft;
}

function parseLegacyValueMappings(
  value: unknown,
  at: string,
  issues: string[],
): CodeMapping[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(`${at}.valueMappings must be an array of {sourceValue, system, code, display}`);
    return null;
  }
  const out: CodeMapping[] = [];
  let ok = true;
  value.forEach((m, j) => {
    if (
      !isPlainObject(m) ||
      typeof m['sourceValue'] !== 'string' ||
      typeof m['code'] !== 'string'
    ) {
      issues.push(`${at}.valueMappings[${j}] must have string "sourceValue" and "code"`);
      ok = false;
      return;
    }
    out.push({
      sourceValue: m['sourceValue'],
      code: m['code'],
      system: typeof m['system'] === 'string' ? m['system'] : '',
      display: typeof m['display'] === 'string' ? m['display'] : m['code'],
    });
  });
  return ok ? out : null;
}

function codeMap(codes: CodeMapping[], field: 'code' | 'display'): Record<string, string> {
  return Object.fromEntries(codes.map((c) => [c.sourceValue, c[field]]));
}

function commonSystem(codes: CodeMapping[]): string | undefined {
  const systems = new Set(codes.map((c) => c.system).filter(Boolean));
  return systems.size === 1 ? [...systems][0] : undefined;
}

/** Is `<Type>.<path>` (path) a CodeableConcept / Coding element rather than a primitive? */
function legacyTargetShape(type: string, path: string): 'CodeableConcept' | 'Coding' | 'other' {
  if (typeof resolveFieldPath(type, path) !== 'string') return 'other';
  if (typeof resolveFieldPath(type, `${path}.coding.code`) !== 'string') return 'CodeableConcept';
  if (typeof resolveFieldPath(type, `${path}.code`) !== 'string') return 'Coding';
  return 'other';
}

/** Prefix a path with `type.` unless it already starts with a known resource type. */
function withResourceType(path: string, type: string): string {
  const first = path.split('.')[0]!;
  return SUPPORTED_RESOURCE_TYPES.includes(first) ? path : `${type}.${path}`;
}

const isResourceIdPath = (target: string) => /^[A-Za-z]+\.id$/.test(target);

/** Legacy `Patient.id` column → patientId (ids are generated deterministically now). */
function claimPatientIdColumn(draft: Draft, column: string, target: string, at: string): void {
  if (target === 'Patient.id' && draft.patientId === undefined) {
    draft.patientId = { column };
    draft.notices.push(
      `${at}: Patient.id → patientId {"column": ${quote(column)}} (resource ids are generated deterministically)`,
    );
  } else {
    draft.notices.push(
      `${at}: mapping to ${target} was ignored (resource ids are generated deterministically)`,
    );
  }
}

// ── Common validation ───────────────────────────────────────────────────────

function buildMapping(
  draft: Draft,
  sourceFormat: ImportMapping['sourceFormat'],
  issues: string[],
): ImportMapping {
  const fields: FieldMapping[] = [];
  const targets = new Map<string, string>();

  for (const raw of draft.fields) {
    const field = parseField(raw, issues);
    if (!field) continue;
    const target = `${field.resourceType}.${field.path}`;
    const previous = targets.get(target);
    if (previous) {
      issues.push(`${previous} and ${raw.label} both map to ${target}`);
      continue;
    }
    targets.set(target, raw.label);
    fields.push(field);
  }

  const patientId = parsePatientId(draft.patientId, issues);
  const timezone = parseTimezone(draft.timezone, issues);
  const resourceTypes = parseResourceTypes(draft.resourceTypes, fields, patientId, issues);
  const sheet = parseSheet(draft.sheet, resourceTypes, issues);

  return {
    ...(draft.description !== undefined ? { description: draft.description } : {}),
    ...(patientId ? { patientId } : {}),
    ...(sheet !== undefined ? { sheet } : {}),
    ...(timezone ? { timezone } : {}),
    resourceTypes,
    fields,
    sourceFormat,
    notices: draft.notices,
  };
}

function parseField(raw: RawField, issues: string[]): FieldMapping | undefined {
  const { label, key, spec } = raw;
  const keyMatch = key.match(/^([A-Za-z]+)\.(.+)$/);
  if (!keyMatch) {
    issues.push(`${label}: key must look like "<ResourceType>.<path>", e.g. "Patient.name.family"`);
    return undefined;
  }
  const resourceType = keyMatch[1]!;
  const resolved = resolveFieldPath(resourceType, keyMatch[2]!);
  if (typeof resolved === 'string') {
    issues.push(`${label}: ${resolved}`);
    return undefined;
  }

  const source = parseSource(label, spec, resolved.kind, resolved.bindingKey, issues);
  if (!source) return undefined;

  return {
    key,
    resourceType,
    path: formatSegments(resolved.segments),
    segments: resolved.segments,
    source,
  };
}

function parseSource(
  label: string,
  spec: unknown,
  kind: string,
  bindingKey: string,
  issues: string[],
): FieldSource | undefined {
  if (typeof spec === 'string') {
    if (spec.trim() === '') {
      issues.push(`${label}: column name must not be empty`);
      return undefined;
    }
    return { kind: 'column', column: spec.trim() };
  }
  if (!isPlainObject(spec)) {
    issues.push(
      `${label}: expected a column name (string), {"column": ...} or {"literal": ...}, got ${describeType(spec)}`,
    );
    return undefined;
  }

  if ('literal' in spec) {
    const extra = Object.keys(spec).filter((k) => k !== 'literal');
    if (extra.length > 0) {
      issues.push(
        `${label}: a {"literal": ...} spec cannot also have ${extra.map(quote).join(', ')}`,
      );
      return undefined;
    }
    return parseLiteral(label, spec['literal'], kind, bindingKey, issues);
  }

  let ok = true;
  for (const k of Object.keys(spec)) {
    if (!COLUMN_SPEC_KEYS.includes(k)) {
      issues.push(
        `${label}: unknown key ${quote(k)} (allowed: ${COLUMN_SPEC_KEYS.join(', ')}, or "literal" alone)`,
      );
      ok = false;
    }
  }
  const { column, transform, format, valueMap } = spec;
  if (typeof column !== 'string' || column.trim() === '') {
    issues.push(`${label}.column must be a non-empty string`);
    ok = false;
  }
  if (transform !== undefined && !FIELD_TRANSFORMS.includes(transform as FieldTransform)) {
    issues.push(
      `${label}.transform: unknown transform ${quote(String(transform))} (allowed: ${FIELD_TRANSFORMS.join(', ')})`,
    );
    ok = false;
  }
  if (format !== undefined) {
    if (typeof format !== 'string' || format === '') {
      issues.push(`${label}.format must be a non-empty string`);
      ok = false;
    } else if (transform !== 'date' && transform !== 'datetime') {
      issues.push(`${label}.format is only used with "transform": "date" or "datetime"`);
      ok = false;
    } else {
      const compiled = compileDateFormat(format);
      if (typeof compiled === 'string') {
        issues.push(`${label}.format: ${compiled}`);
        ok = false;
      }
    }
  }
  if (valueMap !== undefined) {
    if (!isPlainObject(valueMap) || Object.keys(valueMap).length === 0) {
      issues.push(`${label}.valueMap must be a non-empty object of "source value": "output value"`);
      ok = false;
    } else {
      for (const [from, to] of Object.entries(valueMap)) {
        if (typeof to !== 'string') {
          issues.push(
            `${label}.valueMap[${quote(from)}] must be a string, got ${describeType(to)}`,
          );
          ok = false;
        }
      }
    }
  }
  if (!ok) return undefined;

  return {
    kind: 'column',
    column: (column as string).trim(),
    ...(transform !== undefined ? { transform: transform as FieldTransform } : {}),
    ...(format !== undefined ? { format: format as string } : {}),
    ...(valueMap !== undefined ? { valueMap: valueMap as Record<string, string> } : {}),
  };
}

function parseLiteral(
  label: string,
  literal: unknown,
  kind: string,
  bindingKey: string,
  issues: string[],
): FieldSource | undefined {
  if (!['string', 'number', 'boolean'].includes(typeof literal)) {
    issues.push(
      `${label}.literal must be a string, number or boolean, got ${describeType(literal)}`,
    );
    return undefined;
  }
  const value = literal as string | number | boolean;
  if ((kind === 'decimal' || kind === 'integer') && parseNumber(value) === undefined) {
    issues.push(`${label}.literal must be a number for a ${kind} element`);
    return undefined;
  }
  if (kind === 'boolean' && parseBoolean(value) === undefined) {
    issues.push(`${label}.literal must be true or false for a boolean element`);
    return undefined;
  }
  const allowed = REQUIRED_CODE_BINDINGS[bindingKey];
  if (allowed && !allowed.includes(String(value))) {
    issues.push(
      `${label}.literal ${quote(String(value))} is not a valid code (allowed: ${allowed.join(', ')})`,
    );
    return undefined;
  }
  if (typeof value === 'string' && value.trim() === '') {
    issues.push(`${label}.literal must not be empty`);
    return undefined;
  }
  return { kind: 'literal', value };
}

function parsePatientId(value: unknown, issues: string[]): ImportMapping['patientId'] {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    if (value.trim() === '') {
      issues.push('"patientId" must name a column');
      return undefined;
    }
    return { column: value.trim() };
  }
  if (!isPlainObject(value)) {
    issues.push(
      `"patientId" must be a column name or {"column": ..., "system": ...}, got ${describeType(value)}`,
    );
    return undefined;
  }
  let ok = true;
  for (const k of Object.keys(value)) {
    if (k !== 'column' && k !== 'system') {
      issues.push(`"patientId": unknown key ${quote(k)} (allowed: column, system)`);
      ok = false;
    }
  }
  const { column, system } = value;
  if (typeof column !== 'string' || column.trim() === '') {
    issues.push('"patientId.column" must be a non-empty string');
    ok = false;
  }
  if (
    system !== undefined &&
    (typeof system !== 'string' || !/^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(system))
  ) {
    issues.push('"patientId.system" must be an absolute URI, e.g. "urn:oid:..." or "https://..."');
    ok = false;
  }
  if (!ok) return undefined;
  return {
    column: (column as string).trim(),
    ...(system !== undefined ? { system: system as string } : {}),
  };
}

function parseTimezone(value: unknown, issues: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !TIMEZONE_RE.test(value)) {
    issues.push(
      '"timezone" must be a UTC offset like "+07:00", "+09:00", "-05:00" or "Z" (IANA names such as "Asia/Ho_Chi_Minh" are not supported)',
    );
    return undefined;
  }
  return value;
}

function parseResourceTypes(
  value: unknown,
  fields: FieldMapping[],
  patientId: ImportMapping['patientId'],
  issues: string[],
): string[] {
  const fieldTypes = new Set(fields.map((f) => f.resourceType));
  let types: string[];

  if (value === undefined) {
    types = SUPPORTED_RESOURCE_TYPES.filter((t) => fieldTypes.has(t));
  } else if (!Array.isArray(value) || value.length === 0) {
    issues.push('"resourceTypes" must be a non-empty array, e.g. ["Patient", "Encounter"]');
    return [];
  } else {
    types = [];
    for (const t of value) {
      if (typeof t !== 'string' || !SUPPORTED_RESOURCE_TYPES.includes(t)) {
        issues.push(
          `"resourceTypes": unsupported resource type ${quote(String(t))} (supported: ${SUPPORTED_RESOURCE_TYPES.join(', ')})`,
        );
      } else if (types.includes(t)) {
        issues.push(`"resourceTypes": ${quote(t)} is listed twice`);
      } else {
        types.push(t);
      }
    }
    for (const f of fields) {
      if (!types.includes(f.resourceType)) {
        issues.push(
          `fields[${quote(f.key)}]: resource type ${quote(f.resourceType)} is not listed in "resourceTypes" (${types.join(', ')})`,
        );
      }
    }
  }

  const columnTypes = new Set(
    fields.filter((f) => f.source.kind === 'column').map((f) => f.resourceType),
  );
  for (const t of types) {
    if (!columnTypes.has(t) && !(t === 'Patient' && patientId)) {
      issues.push(`"resourceTypes" includes ${quote(t)} but no field maps a column to it`);
    }
    if (NEEDS_PATIENT.has(t) && !types.includes('Patient') && !patientId) {
      issues.push(
        `${t} needs a patient to reference: add "Patient" to "resourceTypes" or set "patientId"`,
      );
    }
  }
  if (types.length === 0 && issues.length === 0) {
    issues.push('mapping produces no resource types — add "fields"');
  }
  return types;
}

function parseSheet(
  value: unknown,
  resourceTypes: string[],
  issues: string[],
): ImportMapping['sheet'] {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    if (value.trim() === '') issues.push('"sheet" must not be empty');
    return value;
  }
  if (!isPlainObject(value)) {
    issues.push(
      `"sheet" must be a sheet name or {"<ResourceType>": "<sheet name>"}, got ${describeType(value)}`,
    );
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [type, name] of Object.entries(value)) {
    if (!resourceTypes.includes(type)) {
      issues.push(
        `"sheet": ${quote(type)} is not in "resourceTypes" (${resourceTypes.join(', ')})`,
      );
    } else if (typeof name !== 'string' || name.trim() === '') {
      issues.push(`"sheet.${type}" must be a non-empty sheet name`);
    } else {
      out[type] = name;
    }
  }
  const missing = resourceTypes.filter((t) => !(t in value));
  if (missing.length > 0) {
    issues.push(
      `"sheet" is per resource type, so it must name a sheet for every entry in "resourceTypes" — missing: ${missing.join(', ')}`,
    );
  }
  return out;
}
