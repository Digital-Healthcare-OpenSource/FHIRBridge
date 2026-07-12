/**
 * Excel (.xlsx) file connector using ExcelJS streaming WorkbookReader.
 * Streams rows one-at-a-time as RawRecords — never loads the full workbook
 * into memory (replaces `wb.xlsx.readFile`, which fully decompresses and was a
 * zip-bomb vector: a 50MB .xlsx can inflate to many GB regardless of MAX_RESOURCES).
 *
 * Guards: compressed-size ceiling (before opening), global row-count ceiling,
 * and per-row cell ceiling.
 *
 * Replaces SheetJS (xlsx@0.18.5) which had unpatched ReDoS + Prototype Pollution CVEs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import type { ConnectorConfig, FileImportConfig } from '@fhirbridge/types';
import type { HisConnector, RawRecord, ConnectionStatus } from './his-connector-interface.js';
import { ConnectorError } from './his-connector-interface.js';
import { mapRow } from './column-mapper.js';
import {
  preloadWorkbookMetadata,
  type PreloadableWorkbookReader,
} from './excel-workbook-preload.js';

/** Compressed-file ceiling — reject .xlsx zip-bomb before opening (bytes). */
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
/** Row-count ceiling across the whole workbook — caps decompressed zip-bomb. */
const MAX_ROWS = 1_000_000;
/** Cell-per-row ceiling — caps absurdly wide rows. */
const MAX_CELLS_PER_ROW = 1_000;

/** Minimal structural view over ExcelJS streaming types (their d.ts omits async iteration). */
type StreamCell = { value: unknown };
interface StreamRow {
  number: number;
  eachCell(
    opts: { includeEmpty?: boolean },
    cb: (cell: StreamCell, colNumber: number) => void,
  ): void;
}
interface StreamWorksheet extends AsyncIterable<StreamRow> {
  name: string;
}

export class ExcelConnector implements HisConnector {
  readonly type = 'excel' as const;

  private config: FileImportConfig | null = null;
  private sheetNames: string[] = [];

  async connect(config: ConnectorConfig): Promise<void> {
    if (config.type !== 'excel') {
      throw new ConnectorError('Expected excel config', 'CONFIG_MISMATCH');
    }

    const resolved = path.resolve(config.filePath);
    if (!fs.existsSync(resolved)) {
      throw new ConnectorError('File not found', 'FILE_NOT_FOUND');
    }

    // Zip-bomb guard: reject an oversized compressed file before any parse.
    const { size } = fs.statSync(resolved);
    if (size > MAX_FILE_BYTES) {
      throw new ConnectorError(`Excel file exceeds ${MAX_FILE_BYTES} byte limit`, 'FILE_TOO_LARGE');
    }

    this.config = { ...config, filePath: resolved };
    // Bounded streaming pass — chỉ lấy tên sheet + enforce row ceiling.
    this.sheetNames = await this.scanSheetNames(resolved);
  }

  async testConnection(): Promise<ConnectionStatus> {
    if (!this.config) {
      return { connected: false, error: 'Not connected', checkedAt: new Date().toISOString() };
    }

    const sheetNames = this.sheetNames;
    return {
      connected: sheetNames.length > 0,
      serverVersion: `ExcelJS (${sheetNames.length} sheet(s): ${sheetNames.join(', ')})`,
      checkedAt: new Date().toISOString(),
    };
  }

  async *fetchPatientData(patientId: string): AsyncIterable<RawRecord> {
    if (!this.config) {
      throw new ConnectorError('Call connect() before fetchPatientData()', 'NOT_CONNECTED');
    }

    const { filePath, sheetName, mapping, patientIdColumn } = this.config;
    const source = `excel:${path.basename(filePath)}`;

    // Resolve sheet name — default to first sheet discovered at connect().
    const targetSheetName = sheetName ?? this.sheetNames[0];
    if (!targetSheetName) {
      throw new ConnectorError('No sheets found in workbook', 'NO_SHEET');
    }

    const reader = await this.openReader(filePath);

    let matched = false;
    let rowCount = 0;

    for await (const worksheet of reader) {
      const isTarget = worksheet.name === targetSheetName;
      if (isTarget) matched = true;

      let headers: string[] = [];

      for await (const row of worksheet) {
        if (++rowCount > MAX_ROWS) {
          throw new ConnectorError('Row count ceiling exceeded', 'ROW_LIMIT');
        }

        // Drain rows of non-target sheets to advance the parser without buffering.
        if (!isTarget) continue;

        if (row.number === 1) {
          headers = extractHeaders(row);
          continue;
        }

        const rawRow = extractRow(row, headers);
        const normalized = normalizeCells(rawRow);

        // Filter by patient ID if specified.
        if (patientIdColumn && normalized[patientIdColumn] !== patientId) {
          continue;
        }

        const records = mapRow(normalized, mapping, source, rowCount);
        for (const record of records) {
          yield record; // yield ngay — không gom mảng
        }
      }
    }

    if (!matched) {
      throw new ConnectorError(`Sheet not found: ${targetSheetName}`, 'SHEET_NOT_FOUND');
    }
  }

  async disconnect(): Promise<void> {
    this.config = null;
    this.sheetNames = [];
  }

  /** Return available sheet names discovered at connect() time. */
  getSheetNames(): string[] {
    return [...this.sheetNames];
  }

  /**
   * Open a streaming WorkbookReader with metadata streams ignored for speed.
   * Metadata (sheet names/rels/shared strings) được preload qua central
   * directory để chịu được zip có `xl/workbook.xml` nằm sau worksheet.
   */
  private async openReader(filePath: string): Promise<AsyncIterable<StreamWorksheet>> {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
      worksheets: 'emit',
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'ignore',
      entries: 'ignore',
    });
    await preloadWorkbookMetadata(reader as unknown as PreloadableWorkbookReader, filePath);
    return reader as unknown as AsyncIterable<StreamWorksheet>;
  }

  /** Streaming pass that collects sheet names while enforcing the row ceiling. */
  private async scanSheetNames(filePath: string): Promise<string[]> {
    const reader = await this.openReader(filePath);
    const names: string[] = [];
    let rowCount = 0;

    for await (const worksheet of reader) {
      names.push(worksheet.name);
      // Drain rows to advance the SAX parser to the next sheet (bounded memory).
      for await (const _row of worksheet) {
        void _row;
        if (++rowCount > MAX_ROWS) {
          throw new ConnectorError('Row count ceiling exceeded', 'ROW_LIMIT');
        }
      }
    }

    return names;
  }
}

/** Extract header names from row 1, capped at MAX_CELLS_PER_ROW columns. */
function extractHeaders(row: StreamRow): string[] {
  const headers: string[] = [];
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber > MAX_CELLS_PER_ROW) return;
    headers[colNumber - 1] = String(cell.value ?? '').trim();
  });
  return headers;
}

/** Extract a data row into a keyed object, capped at MAX_CELLS_PER_ROW columns. */
function extractRow(row: StreamRow, headers: string[]): Record<string, unknown> {
  const rawRow: Record<string, unknown> = {};
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber > MAX_CELLS_PER_ROW) return;
    const header = headers[colNumber - 1];
    if (header) {
      rawRow[header] = cell.value;
    }
  });
  return rawRow;
}

/** Normalize cell values: trim strings, convert Date objects to ISO strings, unwrap ExcelJS rich text/formula */
function normalizeCells(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      result[key] = value.toISOString().slice(0, 10); // YYYY-MM-DD
    } else if (typeof value === 'string') {
      result[key] = value.trim();
    } else if (value !== null && typeof value === 'object' && 'richText' in value) {
      // ExcelJS rich text object — extract plain text
      const richText = (value as { richText: { text: string }[] }).richText;
      result[key] = richText
        .map((r) => r.text)
        .join('')
        .trim();
    } else if (value !== null && typeof value === 'object' && 'result' in value) {
      // ExcelJS formula cell — use computed result
      result[key] = (value as { result: unknown }).result;
    } else {
      result[key] = value;
    }
  }

  return result;
}
