/**
 * Summarize command — generate an AI clinical summary from a FHIR bundle.
 * Runs the same core pipeline as the API: de-identify → section summaries →
 * synthesis → Markdown / FHIR Composition. Needs ANTHROPIC_API_KEY or
 * OPENAI_API_KEY in the environment; fails with a clear message otherwise.
 */

import type { Command } from 'commander';
import { randomBytes } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import {
  CLAUDE_DEFAULT_MODEL,
  OPENAI_DEFAULT_MODEL,
  ProviderGateway,
  formatComposition,
  formatMarkdown,
} from '@fhirbridge/core';
import type { Bundle, SummaryConfig } from '@fhirbridge/types';
import { promptProviderOptions, type ProviderPromptResult } from '../prompts/provider-prompts.js';
import { writeOutput } from '../utils/file-writer.js';
import { info, success, error, warn, useStderrForStatus } from '../utils/logger.js';
import { loadConfig } from '../config/config-manager.js';

const PROVIDERS = ['claude', 'openai'] as const;
const LANGUAGES = ['en', 'vi', 'ja', 'ko'] as const;
const DETAILS = ['brief', 'standard', 'detailed'] as const;
const FORMATS = ['markdown', 'composition'] as const;

/** Env var holding the key for each provider. */
const KEY_ENV: Record<ProviderPromptResult['provider'], string> = {
  claude: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

export function registerSummarizeCommand(program: Command): void {
  program
    .command('summarize')
    .description('Generate AI clinical summary from a FHIR bundle')
    .option('--input <path>', 'Path to FHIR bundle JSON file')
    .option('--provider <claude|openai>', 'AI provider')
    .option('--language <en|vi|ja|ko>', 'Summary language')
    .option('--detail <brief|standard|detailed>', 'Detail level', 'standard')
    .option('--model <id>', 'Override the provider model (default: ANTHROPIC_MODEL / OPENAI_MODEL)')
    .option('--output <path>', 'Output file path (default: stdout)')
    .option('--format <markdown|composition>', 'Output format', 'markdown')
    .action(async (opts: SummarizeOptions) => {
      try {
        await runSummarize(opts);
      } catch (err) {
        error((err as Error).message);
        process.exit(1);
      }
    });
}

interface SummarizeOptions {
  input?: string;
  provider?: string;
  language?: string;
  detail?: string;
  model?: string;
  output?: string;
  format?: string;
}

/** Validate an enum-like CLI option, naming the allowed values on error. */
function oneOf<T extends string>(
  flag: string,
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Invalid ${flag} "${value}". Allowed: ${allowed.join(', ')}`);
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Local id of the first Patient in the bundle — used as Composition.subject. */
function findPatientRef(bundle: Bundle): string {
  const patient = bundle.entry?.find((e) => e.resource?.resourceType === 'Patient')?.resource;
  return patient?.id ? `Patient/${patient.id}` : 'Patient/unknown';
}

async function runSummarize(opts: SummarizeOptions): Promise<void> {
  const inputPath = opts.input;
  if (!inputPath) {
    throw new Error('--input <path> is required for summarize command');
  }
  if (!existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }
  const format = oneOf('--format', opts.format ?? 'markdown', FORMATS) ?? 'markdown';

  const config = loadConfig();

  const providerOpts = await promptProviderOptions({
    provider: oneOf('--provider', opts.provider ?? config.defaultProvider, PROVIDERS),
    language: oneOf('--language', opts.language ?? config.defaultLanguage, LANGUAGES),
    detail: oneOf('--detail', opts.detail, DETAILS),
  });

  const keyEnv = KEY_ENV[providerOpts.provider];
  const apiKey = envValue(keyEnv);
  if (!apiKey) {
    throw new Error(
      `${keyEnv} is not set. Export it first, e.g. \`export ${keyEnv}=...\` ` +
        '(read the data-residency notes in README before sending data abroad).',
    );
  }

  // Summary on stdout → keep stdout pure data (status lines go to stderr).
  useStderrForStatus(!opts.output);
  info(`Reading bundle from: ${inputPath}`);
  let bundle: Bundle;
  try {
    bundle = JSON.parse(readFileSync(inputPath, 'utf8')) as Bundle;
  } catch {
    throw new Error(`Failed to parse FHIR bundle from: ${inputPath}`);
  }
  if (bundle.resourceType !== 'Bundle') {
    throw new Error(`Not a FHIR Bundle: ${inputPath}`);
  }

  const model =
    opts.model ??
    (providerOpts.provider === 'openai'
      ? (envValue('OPENAI_MODEL') ?? OPENAI_DEFAULT_MODEL)
      : (envValue('ANTHROPIC_MODEL') ?? CLAUDE_DEFAULT_MODEL));

  // Optional endpoint override (gateway, regional endpoint, or an OpenAI-compatible
  // server run in-country / inside the hospital).
  const baseUrlEnv = providerOpts.provider === 'openai' ? 'OPENAI_BASE_URL' : 'ANTHROPIC_BASE_URL';
  const baseUrl = envValue(baseUrlEnv);
  let destination = providerOpts.provider === 'openai' ? 'OpenAI' : 'Anthropic';
  if (baseUrl) {
    try {
      destination = new URL(baseUrl).host;
    } catch {
      throw new Error(`${baseUrlEnv} is not a valid URL: ${baseUrl}`);
    }
  }

  // Pseudonyms only need to be stable within one run: without a configured
  // HMAC_SECRET a fresh random key keeps them unlinkable across runs.
  const configuredSecret = envValue('HMAC_SECRET');
  const hmacSecret =
    configuredSecret && configuredSecret.length >= 32
      ? configuredSecret
      : randomBytes(32).toString('hex');

  const summaryConfig: SummaryConfig = {
    language: providerOpts.language,
    detailLevel: providerOpts.detail,
    outputFormats: [format],
    hmacSecret,
    providerConfig: {
      provider: providerOpts.provider,
      model,
      apiKey,
      maxTokens: 16000,
      temperature: 0,
      timeoutMs: 120_000,
      ...(baseUrl ? { baseUrl } : {}),
    },
  };

  warn(
    `De-identified data will be sent to ${destination} ` +
      '(identifiers hashed, names redacted, dates shifted).',
  );
  info(
    `Summarizing with ${providerOpts.provider}/${model} (${providerOpts.language}, ${providerOpts.detail})...`,
  );

  const gateway = new ProviderGateway(summaryConfig);
  let output: string;
  try {
    const summary = await gateway.summarize(bundle, summaryConfig);
    output =
      format === 'composition'
        ? JSON.stringify(formatComposition(summary, findPatientRef(bundle)), null, 2)
        : formatMarkdown(summary);
  } catch (aiErr) {
    throw new Error(`AI summarization failed: ${(aiErr as Error).message}`);
  }

  writeOutput(output, opts.output);
  success(`Summary written` + (opts.output ? ` → ${opts.output}` : ' → stdout'));
}
