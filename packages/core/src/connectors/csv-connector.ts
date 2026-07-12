/**
 * CSV file connector — streams rows as RawRecords using csv-parse.
 * Supports UTF-8, UTF-16 (LE/BE), Shift-JIS, and EUC-JP encodings.
 * Non-UTF-8 buffers được giải mã qua iconv-lite (Node BufferEncoding không có
 * Shift-JIS/EUC-JP) để tránh mojibake im lặng với HIS Nhật/Việt.
 * Never loads the full file into memory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'csv-parse';
import iconv from 'iconv-lite';
import type { ConnectorConfig, FileImportConfig } from '@fhirbridge/types';
import type { HisConnector, RawRecord, ConnectionStatus } from './his-connector-interface.js';
import { ConnectorError } from './his-connector-interface.js';
import { mapRow } from './column-mapper.js';

export class CsvConnector implements HisConnector {
  readonly type = 'csv' as const;

  private config: FileImportConfig | null = null;
  private headers: string[] = [];

  async connect(config: ConnectorConfig): Promise<void> {
    if (config.type !== 'csv') {
      throw new ConnectorError('Expected csv config', 'CONFIG_MISMATCH');
    }

    // Fail-fast encoding không hỗ trợ TRƯỚC mọi thao tác FS — tránh mở stream
    // rồi mới throw (stream mồ côi emit error không ai bắt).
    resolveIconvEncoding(config.encoding);

    // Validate file path — NUL byte không bao giờ hợp lệ trong path thật;
    // path.resolve normalize các segment traversal (../) về absolute path.
    if (config.filePath.includes('\0')) {
      throw new ConnectorError('Invalid file path', 'INVALID_PATH');
    }
    const resolved = path.resolve(config.filePath);

    if (!fs.existsSync(resolved)) {
      throw new ConnectorError(`File not found: path omitted for security`, 'FILE_NOT_FOUND');
    }

    this.config = { ...config, filePath: resolved };
    this.headers = await this.readHeaders(resolved, config);
  }

  async testConnection(): Promise<ConnectionStatus> {
    if (!this.config) {
      return { connected: false, error: 'Not connected', checkedAt: new Date().toISOString() };
    }

    try {
      const stats = fs.statSync(this.config.filePath);
      return {
        connected: true,
        serverVersion: `CSV (${stats.size} bytes)`,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        connected: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async *fetchPatientData(patientId: string): AsyncIterable<RawRecord> {
    if (!this.config) {
      throw new ConnectorError('Call connect() before fetchPatientData()', 'NOT_CONNECTED');
    }

    const { filePath, delimiter, encoding, mapping, patientIdColumn } = this.config;
    const source = `csv:${path.basename(filePath)}`;
    let rowIndex = 0;

    // Giải mã raw bytes qua iconv-lite → chuỗi Unicode chuẩn trước khi parse.
    const stream = fs
      .createReadStream(filePath)
      .pipe(iconv.decodeStream(resolveIconvEncoding(encoding)));

    const parser = stream.pipe(
      parse({
        delimiter: delimiter ?? ',',
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      }),
    );

    for await (const row of parser) {
      rowIndex++;
      const typedRow = row as Record<string, unknown>;

      // Filter by patient ID if a column is specified
      if (patientIdColumn && typedRow[patientIdColumn] !== patientId) {
        continue;
      }

      const records = mapRow(typedRow, mapping, source, rowIndex);
      for (const record of records) {
        yield record;
      }
    }
  }

  async disconnect(): Promise<void> {
    this.config = null;
    this.headers = [];
  }

  /** Read only the header row to validate column names */
  private readHeaders(filePath: string, config: FileImportConfig): Promise<string[]> {
    // Resolve encoding trước khi mở stream — throw ở đây thì chưa có FS handle nào bị bỏ rơi.
    const iconvEncoding = resolveIconvEncoding(config.encoding);

    return new Promise((resolve, reject) => {
      const results: string[] = [];
      const fileStream = fs.createReadStream(filePath, { end: 4096 }); // chỉ đọc 4KB đầu cho header
      const stream = fileStream.pipe(iconv.decodeStream(iconvEncoding));

      const parser = stream.pipe(
        parse({
          delimiter: config.delimiter ?? ',',
          columns: false,
          to_line: (config.headerRow ?? 0) + 1,
          trim: true,
          bom: true,
        }),
      );

      parser.on('data', (row: unknown[]) => {
        if (Array.isArray(row)) results.push(...row.map(String));
      });
      parser.on('end', () => resolve(results));
      parser.on('error', (err) => {
        fileStream.destroy();
        reject(err);
      });
      fileStream.on('error', reject);
    });
  }

  /** Return detected column headers */
  getHeaders(): string[] {
    return [...this.headers];
  }
}

/**
 * Ánh xạ SupportedEncoding / Node alias → nhãn iconv-lite.
 * Bao phủ utf-8, utf-16le/be, shift-jis, euc-jp (+ latin1/ascii legacy).
 */
const ICONV_LABELS: Record<string, string> = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  'utf-16le': 'utf-16le',
  utf16le: 'utf-16le',
  'utf-16be': 'utf-16be',
  utf16be: 'utf-16be',
  'shift-jis': 'shift_jis',
  shift_jis: 'shift_jis',
  shiftjis: 'shift_jis',
  sjis: 'shift_jis',
  'euc-jp': 'euc-jp',
  eucjp: 'euc-jp',
  latin1: 'latin1',
  ascii: 'ascii',
};

/**
 * Resolve an encoding label to an iconv-lite codec, fail-fast on unsupported
 * values so a mistyped encoding surfaces as a config error instead of silent
 * mojibake (corrupted-but-schema-valid là failure mode tệ nhất).
 */
function resolveIconvEncoding(encoding?: string): string {
  const key = (encoding ?? 'utf-8').toLowerCase();
  const label = ICONV_LABELS[key];
  if (!label || !iconv.encodingExists(label)) {
    throw new ConnectorError(`Unsupported encoding: ${encoding}`, 'UNSUPPORTED_ENCODING');
  }
  return label;
}
