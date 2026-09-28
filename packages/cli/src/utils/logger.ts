/**
 * Logger utility — colored console output via chalk.
 * Uses chalk@4 (CJS compatible).
 * No PHI should ever be passed to these methods.
 */

import chalk from 'chalk';

/** Prefix symbols for each log level */
const PREFIX = {
  info: chalk.cyan('ℹ'),
  success: chalk.green('✔'),
  warn: chalk.yellow('⚠'),
  error: chalk.red('✖'),
  debug: chalk.gray('·'),
} as const;

let _verbose = false;
let _quiet = false;
let _statusToStderr = false;

/** Configure logger verbosity flags */
export function configureLogger(opts: { verbose?: boolean; quiet?: boolean }): void {
  _verbose = opts.verbose ?? false;
  _quiet = opts.quiet ?? false;
}

/**
 * Send info / success / debug lines to stderr — used when a command writes its data
 * (bundle, summary) to stdout, so `fhirbridge export … > bundle.json` stays valid JSON.
 */
export function useStderrForStatus(enabled: boolean): void {
  _statusToStderr = enabled;
}

function statusStream(): NodeJS.WriteStream {
  return _statusToStderr ? process.stderr : process.stdout;
}

/** Print informational message to stdout (stderr when data goes to stdout) */
export function info(msg: string): void {
  if (!_quiet) statusStream().write(`${PREFIX.info} ${msg}\n`);
}

/** Print success message to stdout (stderr when data goes to stdout) */
export function success(msg: string): void {
  if (!_quiet) statusStream().write(`${PREFIX.success} ${chalk.green(msg)}\n`);
}

/** Print warning message to stderr */
export function warn(msg: string): void {
  if (!_quiet) process.stderr.write(`${PREFIX.warn} ${chalk.yellow(msg)}\n`);
}

/** Print error message to stderr */
export function error(msg: string): void {
  process.stderr.write(`${PREFIX.error} ${chalk.red(msg)}\n`);
}

/** Print debug message (only when --verbose) */
export function debug(msg: string): void {
  if (_verbose) statusStream().write(`${PREFIX.debug} ${chalk.gray(msg)}\n`);
}

/** Print plain text without prefix (for table/JSON output) */
export function print(msg: string): void {
  process.stdout.write(`${msg}\n`);
}
