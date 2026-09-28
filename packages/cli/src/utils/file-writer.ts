/**
 * File writer utility — write output data to file or stdout.
 * Validates paths to prevent directory traversal.
 */

import { writeFileSync } from 'fs';
import { resolve, normalize } from 'path';
import { error } from './logger.js';

export type OutputFormat = 'json' | 'ndjson' | 'markdown' | 'text';

/** Guard against path traversal attacks */
function safePath(filePath: string): string {
  const normalized = normalize(resolve(filePath));
  // Reject paths that try to escape via null bytes
  if (normalized.includes('\0')) throw new Error('Invalid file path: null byte detected');
  return normalized;
}

/**
 * Write text (UTF-8) or binary data (e.g. a PDF) to a file or stdout.
 * @param data - serialized content to write
 * @param outputPath - file path; if undefined, writes to stdout
 */
export function writeOutput(data: string | Buffer, outputPath?: string): void {
  if (!outputPath) {
    process.stdout.write(data);
    if (typeof data === 'string' && !data.endsWith('\n')) process.stdout.write('\n');
    return;
  }

  try {
    const safe = safePath(outputPath);
    if (typeof data === 'string') writeFileSync(safe, data, { encoding: 'utf8' });
    else writeFileSync(safe, data);
  } catch (err) {
    error(`Failed to write output to "${outputPath}": ${(err as Error).message}`);
    throw err;
  }
}

/**
 * Serialize data to string based on format.
 * @param data - object/array to serialize
 * @param format - output format
 */
export function serialize(data: unknown, format: OutputFormat = 'json'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'ndjson':
      if (Array.isArray(data)) {
        return data.map((item) => JSON.stringify(item)).join('\n');
      }
      return JSON.stringify(data);
    case 'markdown':
    case 'text':
      return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    default:
      return JSON.stringify(data, null, 2);
  }
}
