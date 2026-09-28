/**
 * JSON formatter — pretty-print JSON with optional chalk syntax highlighting.
 */

import chalk from 'chalk';

/**
 * Format data as JSON string (pretty or compact).
 * @param data - any serializable value
 * @param pretty - whether to indent (default true)
 * @param colorize - add chalk syntax colors (default true when TTY)
 */
export function formatJson(data: unknown, pretty = true, colorize = process.stdout.isTTY): string {
  const raw = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  if (!colorize) return raw;
  return colorizeJson(raw);
}

/** Apply chalk colors to a JSON string */
function colorizeJson(json: string): string {
  return json
    .replace(/"([^"]+)":/g, (_m, key: string) => chalk.cyan('"' + key + '"') + ':')
    .replace(/: "([^"]*)"/g, (_m, val: string) => ': ' + chalk.green('"' + val + '"'))
    .replace(/: (\d+\.?\d*)/g, (_m, num: string) => ': ' + chalk.yellow(num))
    .replace(/: (true|false)/g, (_m, bool: string) => ': ' + chalk.magenta(bool))
    .replace(/: (null)/g, (_m, n: string) => ': ' + chalk.gray(n));
}
