/**
 * Provider prompts — AI provider, model, language, and detail level selection.
 */

import { select } from '@inquirer/prompts';

export interface ProviderPromptResult {
  provider: 'claude' | 'openai' | 'gemini';
  language: 'en' | 'vi' | 'ja' | 'ko';
  detail: 'brief' | 'standard' | 'detailed';
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
 * Prompt for AI provider configuration.
 * Only calls requireTTY when interactive input is actually needed.
 */
export async function promptProviderOptions(
  existing: Partial<ProviderPromptResult>,
): Promise<ProviderPromptResult> {
  const needsInteraction = !existing.provider || !existing.language || !existing.detail;
  if (needsInteraction) requireTTY();

  const provider = (existing.provider ??
    (await select<'claude' | 'openai' | 'gemini'>({
      message: 'Select AI provider:',
      choices: [
        { name: 'Claude (Anthropic)', value: 'claude' },
        { name: 'GPT-4 (OpenAI)', value: 'openai' },
        { name: 'Gemini (Google)', value: 'gemini' },
      ],
    }))) as 'claude' | 'openai' | 'gemini';

  const language = (existing.language ??
    (await select<'en' | 'vi' | 'ja' | 'ko'>({
      message: 'Summary language:',
      choices: [
        { name: 'English', value: 'en' },
        { name: 'Vietnamese', value: 'vi' },
        { name: 'Japanese', value: 'ja' },
        { name: 'Korean', value: 'ko' },
      ],
    }))) as 'en' | 'vi' | 'ja' | 'ko';

  const detail = (existing.detail ??
    (await select<'brief' | 'standard' | 'detailed'>({
      message: 'Detail level:',
      choices: [
        { name: 'Brief (1-2 paragraphs)', value: 'brief' },
        { name: 'Standard (structured sections)', value: 'standard' },
        { name: 'Detailed (full clinical narrative)', value: 'detailed' },
      ],
    }))) as 'brief' | 'standard' | 'detailed';

  return { provider, language, detail };
}
