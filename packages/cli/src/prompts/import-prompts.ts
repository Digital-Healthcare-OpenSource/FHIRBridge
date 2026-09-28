/**
 * Import prompts — file picker and column mapping wizard for CSV/Excel import.
 */

import { input, select } from '@inquirer/prompts';
import { existsSync } from 'fs';

export interface ImportPromptResult {
  filePath: string;
  /** Column mapping JSON (required; prompted for in TTY mode) */
  mappingPath?: string;
  outputPath: string;
  format: 'json' | 'ndjson';
}

/** Require TTY before running interactive prompts. */
function requireTTY(): void {
  if (!process.stdin.isTTY) {
    throw new Error(
      'Interactive mode requires a TTY. In CI/non-TTY, provide all arguments explicitly.',
    );
  }
}

/**
 * Prompt for all missing import options interactively.
 * Only calls requireTTY when interactive input is actually needed.
 */
export async function promptImportOptions(
  existing: Partial<ImportPromptResult>,
): Promise<ImportPromptResult> {
  // Determine if we need any interactive prompts before calling requireTTY
  const needsInteraction =
    !existing.filePath ||
    !existing.mappingPath ||
    !existing.format ||
    existing.outputPath === undefined;
  if (needsInteraction) requireTTY();

  const filePath =
    existing.filePath ??
    (await input({
      message: 'Path to CSV or Excel file:',
      validate: (v) => {
        if (!v.trim()) return 'File path is required';
        if (!existsSync(v.trim())) return `File not found: ${v}`;
        return true;
      },
    }));

  // Mapping là bắt buộc cho CSV/Excel — không có mapping thì không sinh được resource nào
  const mappingPath =
    existing.mappingPath ??
    (
      await input({
        message: 'Path to column mapping JSON (start from examples/column-mappings/*.json):',
        validate: (v) => {
          if (!v.trim()) return 'Mapping file path is required';
          if (!existsSync(v.trim())) return `File not found: ${v}`;
          return true;
        },
      })
    ).trim();

  const format = (existing.format ??
    (await select<'json' | 'ndjson'>({
      message: 'Output format:',
      choices: [
        { name: 'JSON (pretty bundle)', value: 'json' },
        { name: 'NDJSON (newline-delimited)', value: 'ndjson' },
      ],
    }))) as 'json' | 'ndjson';

  const outputPath =
    existing.outputPath ??
    (await input({
      message: 'Output file path (leave blank for stdout):',
      default: '',
    }));

  return { filePath, mappingPath, outputPath, format };
}
