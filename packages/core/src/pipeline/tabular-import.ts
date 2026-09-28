/**
 * importTabularFile — CSV/Excel file + canonical ImportMapping → FHIR Bundle.
 * Dùng chung cho CLI `fhirbridge import` và API POST /api/v1/connectors/import.
 *
 * - Kiểm tra magic bytes (xlsx phải là zip; CSV không được là nhị phân).
 * - Excel nhiều sheet: sheet chứa Patient đọc trước, sau đó các sheet còn lại.
 * - Header không khớp mapping → lỗi rõ ràng liệt kê cột mong đợi / cột có trong file.
 * - Id xác định: namespace = sha256 nội dung file (cùng file → cùng id).
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname } from 'node:path';

import type { Bundle, FileImportConfig, ImportMapping } from '@fhirbridge/types';

import { BundleBuilder } from '../bundle/bundle-builder.js';
import { CsvConnector } from '../connectors/csv-connector.js';
import { ExcelConnector } from '../connectors/excel-connector.js';
import type { SourceRow, StreamRowsOptions } from '../connectors/his-connector-interface.js';
import { RowTransformer, type ImportIssue, type ImportStats } from './row-transformer.js';

export type TabularFileType = 'csv' | 'excel';

export interface TabularImportOptions {
  filePath: string;
  /** Detected from the extension when omitted (.xlsx/.xlsm/.xls → excel, else csv) */
  fileType?: TabularFileType;
  mapping: ImportMapping;
  /** Excel: read every resource type from this sheet (overrides mapping.sheet) */
  sheet?: string;
  /** HMAC secret for RRN hashing (else RRN are masked) */
  rrnSecret?: string;
  /** Throw TabularImportError('RESOURCE_LIMIT') beyond this many resources */
  maxResources?: number;
  /** CSV only */
  delimiter?: string;
  /** CSV only (default utf-8) */
  encoding?: FileImportConfig['encoding'];
}

export interface TabularImportResult {
  bundle: Bundle;
  resourceCount: number;
  issues: ImportIssue[];
  stats: ImportStats;
}

export type TabularImportErrorCode =
  'UNSUPPORTED_FILE' | 'NO_MATCHING_COLUMNS' | 'CSV_PARSE' | 'RESOURCE_LIMIT';

/** Import failure caused by the input (file or mapping mismatch) — safe to show users. */
export class TabularImportError extends Error {
  constructor(
    message: string,
    public readonly code: TabularImportErrorCode,
  ) {
    super(message);
    this.name = 'TabularImportError';
  }
}

/** Detect csv/excel from a file name. */
export function detectTabularFileType(filename: string): TabularFileType {
  const ext = extname(filename).toLowerCase();
  return ext === '.xlsx' || ext === '.xlsm' || ext === '.xls' ? 'excel' : 'csv';
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

/** Magic-byte sniffing: reject content that does not match the declared type. */
export async function assertTabularContent(
  filePath: string,
  fileType: TabularFileType,
  encoding?: string,
): Promise<void> {
  const handle = await open(filePath, 'r');
  let head: Buffer;
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    head = buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }

  if (fileType === 'excel') {
    if (head.subarray(0, 4).equals(OLE_MAGIC)) {
      throw new TabularImportError(
        'Legacy .xls (BIFF) workbooks are not supported — save the file as .xlsx',
        'UNSUPPORTED_FILE',
      );
    }
    if (!head.subarray(0, 4).equals(ZIP_MAGIC)) {
      throw new TabularImportError('File content is not an .xlsx workbook', 'UNSUPPORTED_FILE');
    }
    return;
  }

  const utf16 = (encoding ?? '').toLowerCase().replace(/[-_]/g, '').startsWith('utf16');
  if (!utf16 && (head.includes(0) || head.subarray(0, 4).equals(ZIP_MAGIC))) {
    throw new TabularImportError(
      'File content is binary, not a text CSV (for Excel workbooks use an .xlsx file name)',
      'UNSUPPORTED_FILE',
    );
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** One read pass: which sheet, which resource types. */
interface Pass {
  sheet?: string;
  types: string[];
}

function planPasses(
  mapping: ImportMapping,
  fileType: TabularFileType,
  sheetOverride?: string,
): Pass[] {
  const all = mapping.resourceTypes;
  if (fileType === 'csv') return [{ types: all }];
  if (sheetOverride) return [{ sheet: sheetOverride, types: all }];
  const sheet = mapping.sheet;
  if (sheet === undefined) return [{ types: all }];
  if (typeof sheet === 'string') return [{ sheet, types: all }];

  // Per-type sheets: Patient's sheet first so later sheets can reference patients.
  const ordered = [...all].sort((a, b) => (a === 'Patient' ? -1 : b === 'Patient' ? 1 : 0));
  const passes: Pass[] = [];
  for (const type of ordered) {
    const name = sheet[type]!;
    const pass = passes.find((p) => p.sheet === name);
    if (pass) pass.types.push(type);
    else passes.push({ sheet: name, types: [type] });
  }
  return passes;
}

const list = (names: string[], max = 15) =>
  names.length <= max
    ? names.map((n) => `"${n}"`).join(', ')
    : `${names
        .slice(0, max)
        .map((n) => `"${n}"`)
        .join(', ')} … (+${names.length - max} more)`;

/**
 * Compare the header row with the columns this pass needs.
 * Throws when nothing matches (almost always the wrong mapping for the file);
 * returns warnings for individually missing columns.
 */
function checkHeaders(
  mapping: ImportMapping,
  pass: Pass,
  headers: string[],
  fileType: TabularFileType,
): ImportIssue[] {
  const where = pass.sheet
    ? `sheet "${pass.sheet}"`
    : fileType === 'excel'
      ? 'the first sheet'
      : 'the CSV';
  const present = new Set(headers);
  const needed = new Map<string, string[]>(); // column → field keys
  for (const f of mapping.fields) {
    if (f.source.kind !== 'column' || !pass.types.includes(f.resourceType)) continue;
    needed.set(f.source.column, [...(needed.get(f.source.column) ?? []), f.key]);
  }

  const pid = mapping.patientId;
  if (pid && !present.has(pid.column)) {
    throw new TabularImportError(
      `patientId column "${pid.column}" was not found in the header row of ${where}. File columns: ${list(headers)}`,
      'NO_MATCHING_COLUMNS',
    );
  }
  const missing = [...needed.keys()].filter((c) => !present.has(c));
  if (missing.length === needed.size && needed.size > 0) {
    throw new TabularImportError(
      `None of the mapped columns were found in the header row of ${where}. ` +
        `Mapping expects: ${list([...needed.keys()])}. File columns: ${list(headers)}. ` +
        'Check that the mapping matches this file (examples: examples/column-mappings/).',
      'NO_MATCHING_COLUMNS',
    );
  }
  return missing.map((column) => ({
    severity: 'warning' as const,
    ...(pass.sheet ? { sheet: pass.sheet } : {}),
    column,
    message: `column not found in the header row — ${needed.get(column)!.join(', ')} will be empty`,
  }));
}

/** Map csv-parse errors to a message without cell contents (no PHI). */
function wrapParseError(err: unknown): unknown {
  const e = err as { code?: unknown; lines?: unknown };
  if (typeof e?.code === 'string' && e.code.startsWith('CSV_')) {
    const line = typeof e.lines === 'number' ? ` near line ${e.lines}` : '';
    return new TabularImportError(`CSV could not be parsed (${e.code}${line})`, 'CSV_PARSE');
  }
  return err;
}

/**
 * Import a CSV/Excel file with a parsed ImportMapping.
 * @throws TabularImportError for input problems; ConnectorError for file-level guards
 */
export async function importTabularFile(
  options: TabularImportOptions,
): Promise<TabularImportResult> {
  const { filePath, mapping, rrnSecret, maxResources } = options;
  const fileType = options.fileType ?? detectTabularFileType(filePath);
  await assertTabularContent(filePath, fileType, options.encoding);

  const transformer = new RowTransformer(mapping, {
    ...(rrnSecret ? { rrnSecret } : {}),
    idNamespace: await sha256File(filePath),
  });
  const builder = new BundleBuilder();
  // mapping.notices (chuyển đổi legacy) không phải lỗi dữ liệu — caller tự hiển thị
  const issues: ImportIssue[] = [];
  let resourceCount = 0;

  const connector = fileType === 'excel' ? new ExcelConnector() : new CsvConnector();
  await connector.connect(
    fileType === 'excel'
      ? { type: 'excel', filePath }
      : {
          type: 'csv',
          filePath,
          ...(options.delimiter ? { delimiter: options.delimiter } : {}),
          ...(options.encoding ? { encoding: options.encoding } : {}),
        },
  );

  try {
    for (const pass of planPasses(mapping, fileType, options.sheet)) {
      let headers: string[] | undefined;
      let checked = false;
      const streamOptions: StreamRowsOptions = {
        ...(pass.sheet ? { sheet: pass.sheet } : {}),
        onHeaders: (h) => {
          headers = h;
        },
      };
      const rows: AsyncIterable<SourceRow> = connector.streamRows(streamOptions);

      try {
        for await (const row of rows) {
          if (!checked) {
            issues.push(...checkHeaders(mapping, pass, headers ?? [], fileType));
            checked = true;
          }
          const out = transformer.transformRow(row, pass.types);
          issues.push(...out.issues);
          for (const r of out.resources) {
            if (maxResources !== undefined && resourceCount >= maxResources) {
              throw new TabularImportError(
                `Import exceeds the limit of ${maxResources} resources — split the file into smaller batches`,
                'RESOURCE_LIMIT',
              );
            }
            resourceCount++;
            builder.addResourceWithUrl(r.resource, r.fullUrl);
          }
        }
      } catch (err) {
        throw wrapParseError(err);
      }
      if (!checked && headers) issues.push(...checkHeaders(mapping, pass, headers, fileType));
    }
  } finally {
    await connector.disconnect();
  }

  return { bundle: builder.build(), resourceCount, issues, stats: transformer.getStats() };
}
