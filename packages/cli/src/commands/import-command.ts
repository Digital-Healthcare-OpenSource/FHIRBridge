/**
 * Import command — CSV/Excel + column mapping → FHIR R4 Bundle.
 *
 * Mapping: canonical "fields" format (examples/column-mappings/*.json); legacy
 * {mappings:[...]} và flat {"col": "fhirPath"} vẫn được nhận (tự chuyển đổi).
 * Exit 1 khi mapping sai, file không khớp mapping, hoặc không sinh resource nào.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import {
  importTabularFile,
  parseMappingConfig,
  formatImportIssue,
  serializeToJson,
  serializeToNdjson,
  MappingConfigError,
  detectTabularFileType,
} from '@fhirbridge/core';
import type { ImportMapping } from '@fhirbridge/types';
import { promptImportOptions } from '../prompts/import-prompts.js';
import { writeOutput } from '../utils/file-writer.js';
import { info, success, error, warn, debug } from '../utils/logger.js';

/** Max issues printed individually (the rest are summarized). */
const MAX_PRINTED_ISSUES = 20;

export const MAPPING_REQUIRED_MESSAGE =
  '--mapping <path> is required for CSV/Excel import. Start from one of ' +
  'examples/column-mappings/*.json (see examples/README.md).';

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Import patient data from CSV or Excel and produce a FHIR bundle')
    .option('--file <path>', 'Path to CSV or Excel (.xlsx) file')
    .option(
      '--mapping <path>',
      'Column mapping JSON (required; see examples/column-mappings/ and examples/README.md)',
    )
    .option('--sheet <name>', 'Excel: read all resource types from this sheet (overrides mapping)')
    .option(
      '--resource-type <type>',
      'Resource type for unprefixed paths in legacy flat mappings',
      'Patient',
    )
    .option('--output <path>', 'Output file path (default: stdout)')
    .option('--format <json|ndjson>', 'Output format', 'json')
    .action(async (opts: ImportOptions, cmd: Command) => {
      try {
        const globals = cmd.optsWithGlobals<{ quiet?: boolean }>();
        await runImport(opts, globals.quiet === true);
      } catch (err) {
        error((err as Error).message);
        process.exit(1);
      }
    });
}

interface ImportOptions {
  file?: string;
  mapping?: string;
  sheet?: string;
  resourceType?: string;
  output?: string;
  format?: string;
}

/** Read + validate a mapping file; errors name the file and every problem. */
export function loadMappingFile(mappingPath: string, defaultResourceType?: string): ImportMapping {
  if (!existsSync(mappingPath)) {
    throw new Error(`Mapping file not found: ${mappingPath}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(mappingPath, 'utf8'));
  } catch (err) {
    throw new Error(`Mapping file ${mappingPath} is not valid JSON: ${(err as Error).message}`);
  }
  try {
    return parseMappingConfig(json, { defaultResourceType });
  } catch (err) {
    if (err instanceof MappingConfigError) {
      throw new Error(
        `Invalid mapping file ${mappingPath}:\n  - ${err.issues.join('\n  - ')}\n` +
          'See examples/README.md for the mapping format.',
      );
    }
    throw err;
  }
}

/**
 * Status output: logger ghi info/success ra stdout — khi bundle cũng ra stdout
 * thì chuyển status sang stderr để output pipe được (`> bundle.json`).
 */
function statusReporter(toStdout: boolean, quiet: boolean) {
  if (!toStdout) return { info, success };
  const write = (prefix: string, msg: string) => {
    if (!quiet) process.stderr.write(`${prefix} ${msg}\n`);
  };
  return {
    info: (msg: string) => write(chalk.cyan('ℹ'), msg),
    success: (msg: string) => write(chalk.green('✔'), chalk.green(msg)),
  };
}

async function runImport(opts: ImportOptions, quiet = false): Promise<void> {
  if (opts.format && opts.format !== 'json' && opts.format !== 'ndjson') {
    throw new Error(`Unsupported --format "${opts.format}" (use json or ndjson)`);
  }
  // Non-TTY (CI/script): mapping bắt buộc — báo rõ thay vì lỗi TTY chung chung
  if (!opts.mapping && !process.stdin.isTTY) {
    throw new Error(MAPPING_REQUIRED_MESSAGE);
  }

  const resolved = await promptImportOptions({
    filePath: opts.file,
    mappingPath: opts.mapping,
    // Pass empty string for outputPath (meaning stdout) to avoid requiring TTY when no --output flag
    outputPath: opts.output ?? '',
    format: opts.format as 'json' | 'ndjson' | undefined,
  });

  if (!existsSync(resolved.filePath)) {
    throw new Error(`Input file not found: ${resolved.filePath}`);
  }
  if (!resolved.mappingPath) {
    throw new Error(MAPPING_REQUIRED_MESSAGE);
  }

  const status = statusReporter(!resolved.outputPath, quiet);
  const mapping = loadMappingFile(resolved.mappingPath, opts.resourceType);
  debug(`Loaded mapping: ${resolved.mappingPath} (${mapping.sourceFormat} format)`);
  for (const notice of mapping.notices) status.info(`Mapping: ${notice}`);

  const fileType = detectTabularFileType(resolved.filePath);
  if (opts.sheet && fileType !== 'excel') warn('--sheet is ignored for CSV files');
  status.info(`Reading ${fileType === 'excel' ? 'Excel' : 'CSV'} file: ${resolved.filePath}`);

  // PIPA: RRN (주민등록번호) được HMAC-hash nếu có secret, không thì mask —
  // không bao giờ giữ raw RRN trong output.
  // Same key name as the API (HMAC_SECRET); FHIRBRIDGE_HMAC_SECRET wins when both are set.
  const rrnSecret =
    process.env['FHIRBRIDGE_HMAC_SECRET'] || process.env['HMAC_SECRET'] || undefined;
  const result = await importTabularFile({
    filePath: resolved.filePath,
    fileType,
    mapping,
    ...(opts.sheet && fileType === 'excel' ? { sheet: opts.sheet } : {}),
    ...(rrnSecret ? { rrnSecret } : {}),
  });

  const { stats, issues } = result;
  for (const issue of issues.slice(0, MAX_PRINTED_ISSUES)) {
    warn(formatImportIssue(issue));
  }
  if (issues.length > MAX_PRINTED_ISSUES) {
    warn(`… and ${issues.length - MAX_PRINTED_ISSUES} more issue(s)`);
  }

  const counts = Object.entries(stats.resourcesByType)
    .map(([type, n]) => `${type} ${n}`)
    .join(', ');
  status.info(
    `Rows read: ${stats.rowsRead}${stats.rowsSkipped ? ` (${stats.rowsSkipped} skipped)` : ''}`,
  );
  if (stats.rrnValuesProtected > 0) {
    status.info(
      `RRN values ${rrnSecret ? 'HMAC-hashed' : 'masked (set HMAC_SECRET to hash instead)'}: ${stats.rrnValuesProtected}`,
    );
  }

  if (result.resourceCount === 0) {
    throw new Error(
      `No FHIR resources were produced from ${stats.rowsRead} row(s) — nothing written. ` +
        'Check that the mapping columns match the file header (see warnings above).',
    );
  }

  const output =
    resolved.format === 'ndjson'
      ? serializeToNdjson(result.bundle)
      : serializeToJson(result.bundle);
  writeOutput(output, resolved.outputPath || undefined);

  status.success(
    `Imported ${result.resourceCount} resources (${counts}) from ${stats.rowsRead} rows` +
      (resolved.outputPath ? ` → ${resolved.outputPath}` : ' → stdout'),
  );
}
