/**
 * Value transforms for CSV/Excel import: date/datetime parsing with explicit
 * format tokens, strict numbers/booleans, UTC-offset handling.
 *
 * Lỗi trả về dạng string (không throw) và KHÔNG chứa giá trị ô — tránh PHI
 * trong log/response; caller tự thêm row/column vào thông báo.
 */

/** Date/time components parsed from a cell. Missing parts = lower precision. */
export interface DateParts {
  year: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
  /** "Z" or "±HH:MM" when the value carried its own offset */
  offset?: string;
}

type FormatToken = 'YYYY' | 'MM' | 'DD' | 'HH' | 'mm' | 'ss' | 'Z';

/** A compiled `format` string ready for matching. */
export interface CompiledDateFormat {
  source: string;
  regex: RegExp;
  tokens: FormatToken[];
  hasTime: boolean;
}

/** Supported format tokens (documented in examples/README.md). */
export const DATE_FORMAT_TOKENS: readonly FormatToken[] = [
  'YYYY',
  'MM',
  'DD',
  'HH',
  'mm',
  'ss',
  'Z',
];

const TOKEN_RE = /YYYY|MM|DD|HH|mm|ss|Z/g;

const TOKEN_PATTERNS: Record<FormatToken, string> = {
  YYYY: '(\\d{4})',
  MM: '(\\d{1,2})',
  DD: '(\\d{1,2})',
  HH: '(\\d{1,2})',
  mm: '(\\d{1,2})',
  ss: '(\\d{1,2})(?:\\.\\d+)?',
  Z: '(Z|[+-]\\d{2}:?\\d{2})',
};

/** Mapping-level `timezone`: a fixed UTC offset. */
export const TIMEZONE_RE = /^(Z|[+-](0\d|1[0-4]):[0-5]\d)$/;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a format like "DD/MM/YYYY HH:mm" or "YYYY-MM-DDTHH:mm:ssZ".
 * @returns the compiled format, or an error message
 */
export function compileDateFormat(format: string): CompiledDateFormat | string {
  const tokens: FormatToken[] = [];
  let pattern = '^';
  let last = 0;

  const checkLiteral = (literal: string): string | undefined => {
    const letters = literal.replace(/T/g, '').match(/[A-Za-z]+/);
    if (letters) {
      return `unsupported token "${letters[0]}" in format "${format}" (supported: ${DATE_FORMAT_TOKENS.join(', ')}; "T" is a literal)`;
    }
    return undefined;
  };

  for (const match of format.matchAll(TOKEN_RE)) {
    const literal = format.slice(last, match.index);
    const literalError = checkLiteral(literal);
    if (literalError) return literalError;
    const token = match[0] as FormatToken;
    if (tokens.includes(token)) return `token ${token} appears twice in format "${format}"`;
    tokens.push(token);
    pattern += escapeRegex(literal) + TOKEN_PATTERNS[token];
    last = (match.index ?? 0) + token.length;
  }
  const tail = format.slice(last);
  const tailError = checkLiteral(tail);
  if (tailError) return tailError;
  pattern += escapeRegex(tail) + '$';

  const has = (t: FormatToken) => tokens.includes(t);
  if (!has('YYYY')) return `format "${format}" must contain YYYY (4-digit year)`;
  if (has('DD') && !has('MM')) return `format "${format}" has DD but no MM`;
  if (has('HH') && !has('DD')) return `format "${format}" has HH but no DD`;
  if (has('mm') && !has('HH')) return `format "${format}" has mm but no HH`;
  if (has('ss') && !has('mm')) return `format "${format}" has ss but no mm`;

  return { source: format, regex: new RegExp(pattern), tokens, hasTime: has('HH') };
}

/** Normalize "+0700"/"+07:00"/"Z" → "+07:00"/"Z"; undefined if out of range. */
function normalizeOffset(raw: string): string | undefined {
  if (raw === 'Z') return 'Z';
  const m = raw.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return undefined;
  const normalized = `${m[1]}${m[2]}:${m[3]}`;
  return TIMEZONE_RE.test(normalized) ? normalized : undefined;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Range/calendar check; returns an error message or undefined. */
function checkParts(p: DateParts): string | undefined {
  if (p.month !== undefined && (p.month < 1 || p.month > 12)) return 'month out of range';
  if (p.day !== undefined && p.month !== undefined) {
    if (p.day < 1 || p.day > daysInMonth(p.year, p.month)) return 'day out of range';
  }
  if (p.hour !== undefined && p.hour > 23) return 'hour out of range';
  if (p.minute !== undefined && p.minute > 59) return 'minute out of range';
  if (p.second !== undefined && p.second > 59) return 'second out of range';
  return undefined;
}

/** Parse a value with an explicit compiled format. */
function parseWithFormat(text: string, format: CompiledDateFormat): DateParts | string {
  const match = text.match(format.regex);
  if (!match) return `value does not match format "${format.source}"`;
  const parts: DateParts = { year: 0 };
  format.tokens.forEach((token, i) => {
    const raw = match[i + 1]!;
    switch (token) {
      case 'YYYY':
        parts.year = Number(raw);
        break;
      case 'MM':
        parts.month = Number(raw);
        break;
      case 'DD':
        parts.day = Number(raw);
        break;
      case 'HH':
        parts.hour = Number(raw);
        break;
      case 'mm':
        parts.minute = Number(raw);
        break;
      case 'ss':
        parts.second = Number(raw);
        break;
      case 'Z':
        parts.offset = normalizeOffset(raw) ?? '!';
        break;
    }
  });
  if (parts.offset === '!') return 'invalid UTC offset';
  if (parts.hour !== undefined && parts.minute === undefined) parts.minute = 0;
  return checkParts(parts) ?? parts;
}

/**
 * Resolve day/month order for `d/m/yyyy`: DMY by default (VN/JP/KR/EU), but
 * swap when the DMY reading gives month > 12 and the MDY reading is valid.
 */
function dayMonth(first: string, second: string): { day: number; month: number } {
  let day = Number(first);
  let month = Number(second);
  if (month > 12 && day <= 12) [day, month] = [month, day];
  return { day, month };
}

/** Auto-detect common date / datetime layouts (used when no `format` is given). */
function parseAuto(text: string): DateParts | string {
  let m: RegExpMatchArray | null;

  // FHIR partial dates: YYYY, YYYY-MM
  if ((m = text.match(/^(\d{4})(?:-(\d{2}))?$/))) {
    const parts: DateParts = { year: Number(m[1]) };
    if (m[2]) parts.month = Number(m[2]);
    return checkParts(parts) ?? parts;
  }

  // ISO-like: YYYY-MM-DD or YYYY/MM/DD [T| ]HH:mm[:ss[.fff]][offset]
  m = text.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/,
  );
  if (m) return buildParts(m[1]!, m[2]!, m[3]!, m[4], m[5], m[6], m[7]);

  // Compact YYYYMMDD
  if ((m = text.match(/^(\d{4})(\d{2})(\d{2})$/))) return buildParts(m[1]!, m[2]!, m[3]!);

  // D/M/YYYY, D-M-YYYY, D.M.YYYY [HH:mm[:ss]]
  m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const { day, month } = dayMonth(m[1]!, m[2]!);
    return buildParts(m[3]!, String(month), String(day), m[4], m[5], m[6]);
  }

  return 'unrecognized date (set "format", e.g. "DD/MM/YYYY")';
}

function buildParts(
  y: string,
  mo: string,
  d: string,
  h?: string,
  mi?: string,
  s?: string,
  offset?: string,
): DateParts | string {
  const parts: DateParts = { year: Number(y), month: Number(mo), day: Number(d) };
  if (h !== undefined) {
    parts.hour = Number(h);
    parts.minute = Number(mi ?? 0);
    if (s !== undefined) parts.second = Number(s);
  }
  if (offset !== undefined) {
    const normalized = normalizeOffset(offset);
    if (!normalized) return 'invalid UTC offset';
    parts.offset = normalized;
  }
  return checkParts(parts) ?? parts;
}

/**
 * Parse a cell into DateParts.
 * - `Date` (Excel date cells): UTC components = wall-clock time in the sheet;
 *   rounded to the second (serial-number float noise). Midnight = date only.
 * - string: explicit `format` if given, else auto-detection.
 */
export function parseDateValue(value: unknown, format?: CompiledDateFormat): DateParts | string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return 'invalid date';
    const d = new Date(Math.round(value.getTime() / 1000) * 1000);
    const parts: DateParts = {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    };
    if (d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds()) {
      parts.hour = d.getUTCHours();
      parts.minute = d.getUTCMinutes();
      parts.second = d.getUTCSeconds();
    }
    return parts;
  }
  const text = String(value).trim();
  if (!text) return 'empty value';
  return format ? parseWithFormat(text, format) : parseAuto(text);
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** DateParts → FHIR `date` (YYYY, YYYY-MM or YYYY-MM-DD). */
export function toFhirDate(p: DateParts): string {
  let out = pad(p.year, 4);
  if (p.month !== undefined) out += `-${pad(p.month)}`;
  if (p.month !== undefined && p.day !== undefined) out += `-${pad(p.day)}`;
  return out;
}

/**
 * DateParts → FHIR `dateTime`. FHIR requires an offset whenever a time is
 * present: dùng offset của chính giá trị, rồi tới `timezone` của mapping; không
 * có cả hai → chỉ xuất phần ngày (`timeDropped: true` để caller cảnh báo).
 */
export function toFhirDateTime(
  p: DateParts,
  timezone?: string,
): { value: string; timeDropped: boolean } {
  const date = toFhirDate(p);
  if (p.hour === undefined || p.day === undefined) return { value: date, timeDropped: false };
  const offset = p.offset ?? timezone;
  if (!offset) return { value: date, timeDropped: true };
  const time = `${pad(p.hour)}:${pad(p.minute ?? 0)}:${pad(p.second ?? 0)}`;
  return { value: `${date}T${time}${offset}`, timeDropped: false };
}

/** Strict decimal parse — rejects "12abc", "1,234", empty strings. */
export function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const text = String(value).trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

const TRUE_VALUES = new Set(['true', 'yes', 'y', '1']);
const FALSE_VALUES = new Set(['false', 'no', 'n', '0']);

/** Parse true/false/yes/no/y/n/1/0 (case-insensitive). */
export function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;
  return undefined;
}

/**
 * Plain-text rendering of a cell for string-typed elements.
 * Date cells → FHIR-style date / local datetime text (no offset invented).
 */
export function cellToText(value: unknown): string {
  if (value instanceof Date) {
    const parts = parseDateValue(value);
    if (typeof parts === 'string') return '';
    if (parts.hour === undefined) return toFhirDate(parts);
    return `${toFhirDate(parts)}T${pad(parts.hour)}:${pad(parts.minute ?? 0)}:${pad(parts.second ?? 0)}`;
  }
  return String(value).trim();
}
