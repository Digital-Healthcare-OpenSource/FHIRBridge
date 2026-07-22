/**
 * Summarize command — generate AI clinical summary from a FHIR bundle.
 * AI module is an optional dependency; gracefully handles absence.
 */

import type { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import type { Bundle } from '@fhirbridge/core';
import { promptProviderOptions } from '../prompts/provider-prompts.js';
import { writeOutput } from '../utils/file-writer.js';
import { info, success, error, warn } from '../utils/logger.js';
import { loadConfig } from '../config/config-manager.js';

export function registerSummarizeCommand(program: Command): void {
  program
    .command('summarize')
    .description('Generate AI clinical summary from a FHIR bundle')
    .option('--input <path>', 'Path to FHIR bundle JSON file')
    .option('--provider <claude|openai|gemini>', 'AI provider')
    .option('--language <en|vi|ja|ko|zh>', 'Summary language')
    .option('--detail <brief|standard|detailed>', 'Detail level', 'standard')
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
  output?: string;
  format?: string;
}

async function runSummarize(opts: SummarizeOptions): Promise<void> {
  const inputPath = opts.input;
  if (!inputPath) {
    throw new Error('--input <path> is required for summarize command');
  }
  if (!existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  const config = loadConfig();

  const providerOpts = await promptProviderOptions({
    provider: (opts.provider ?? config.defaultProvider) as
      'claude' | 'openai' | 'gemini' | undefined,
    language: (opts.language ?? config.defaultLanguage) as
      'en' | 'vi' | 'ja' | 'ko' | 'zh' | undefined,
    detail: opts.detail as 'brief' | 'standard' | 'detailed' | undefined,
  });

  info(`Reading bundle from: ${inputPath}`);
  let bundle: Bundle;
  try {
    bundle = JSON.parse(readFileSync(inputPath, 'utf8')) as Bundle;
  } catch {
    throw new Error(`Failed to parse FHIR bundle from: ${inputPath}`);
  }

  info(
    `Summarizing with ${providerOpts.provider} (${providerOpts.language}, ${providerOpts.detail})...`,
  );

  let summary = '';
  try {
    // Dynamic import — ai package may not exist in all environments
    const aiModule = (await import('@fhirbridge/ai' as string).catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (aiModule && 'generateSummary' in aiModule) {
      const generateSummary = aiModule['generateSummary'] as (params: {
        bundle: Bundle;
        provider: string;
        language: string;
        detail: string;
      }) => Promise<{ text: string; tokens?: number }>;

      const result = await generateSummary({
        bundle,
        provider: providerOpts.provider,
        language: providerOpts.language,
        detail: providerOpts.detail,
      });
      summary = result.text;
      if (result.tokens) info(`Token usage: ${result.tokens}`);
    } else {
      warn('AI module (@fhirbridge/ai) not available. Generating placeholder summary.');
      summary = generatePlaceholderSummary(bundle, providerOpts);
    }
  } catch (aiErr) {
    error(`AI summarization failed: ${(aiErr as Error).message}`);
    throw aiErr;
  }

  writeOutput(summary, opts.output);
  success(`Summary written` + (opts.output ? ` → ${opts.output}` : ' → stdout'));
}

function generatePlaceholderSummary(
  bundle: Bundle,
  opts: { provider: string; language: string; detail: string },
): string {
  const count = bundle.entry?.length ?? 0;
  return [
    `# Clinical Summary`,
    ``,
    `**Provider:** ${opts.provider} | **Language:** ${opts.language} | **Detail:** ${opts.detail}`,
    `**Resources:** ${count}`,
    ``,
    `> Note: AI module not installed. Install @fhirbridge/ai to generate real summaries.`,
  ].join('\n');
}
