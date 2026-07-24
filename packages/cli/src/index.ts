/**
 * @fhirbridge/cli — Commander.js CLI entry point.
 * Registers all subcommands and parses process.argv.
 */

import { Command } from 'commander';
import { configureLogger } from './utils/logger.js';
import { registerExportCommand } from './commands/export-command.js';
import { registerImportCommand } from './commands/import-command.js';
import { registerSummarizeCommand } from './commands/summarize-command.js';
import { registerValidateCommand } from './commands/validate-command.js';
import { registerConfigCommand } from './commands/config-command.js';

// Package version — matches package.json
const VERSION = '0.2.0';

export const CLI_VERSION = VERSION;
export const CLI_NAME = 'fhirbridge';

/** Placeholder: returns CLI metadata (kept for backward compat) */
export function getCliInfo(): { name: string; version: string } {
  return { name: CLI_NAME, version: CLI_VERSION };
}

/** Build and return the Commander program (exported for testing). */
export function buildProgram(): Command {
  const program = new Command()
    .name('fhirbridge')
    .description('FHIR R4 Patient Data Export Tool')
    .version(VERSION, '-V, --version')
    .option('--verbose', 'Enable verbose debug output')
    .option('--quiet', 'Suppress non-error output')
    .option('--no-color', 'Disable colored output')
    .hook('preAction', (_thisCommand, actionCommand) => {
      const opts = program.opts<{ verbose?: boolean; quiet?: boolean; color?: boolean }>();
      configureLogger({ verbose: opts.verbose, quiet: opts.quiet });
      if (opts.color === false) {
        // chalk respects NO_COLOR env var; set it for child processes too
        process.env.NO_COLOR = '1';
        process.env.FORCE_COLOR = '0';
      }
      void actionCommand; // suppress unused warning
    });

  registerExportCommand(program);
  registerImportCommand(program);
  registerSummarizeCommand(program);
  registerValidateCommand(program);
  registerConfigCommand(program);

  return program;
}

/** Main entry — only called when run as CLI (not imported as library). */
export async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}
