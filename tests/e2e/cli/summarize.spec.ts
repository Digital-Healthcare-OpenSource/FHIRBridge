/**
 * E2E tests for `fhirbridge summarize` command.
 * Runs CLI as a real subprocess — no mocks.
 * No provider API key is set — tests verify the command fails fast with a clear message.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli, createTempDir, cleanTempDir } from './cli-test-helper.js';

const SAMPLE_BUNDLE = JSON.stringify({
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      resource: {
        resourceType: 'Patient',
        id: 'summarize-test-1',
        name: [{ family: 'Smith', given: ['Jane'] }],
      },
    },
  ],
});

let tempDir: string;
let bundlePath: string;

beforeAll(async () => {
  tempDir = await createTempDir();
  bundlePath = join(tempDir, 'bundle.json');
  await writeFile(bundlePath, SAMPLE_BUNDLE, 'utf8');
});

afterAll(async () => {
  await cleanTempDir(tempDir);
});

describe('fhirbridge summarize', () => {
  it('exits 0 and shows --provider in --help output', async () => {
    const result = await runCli(['summarize', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/--provider/);
  });

  it('--help output includes --input and --language flags', async () => {
    const result = await runCli(['summarize', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/--input/);
    expect(result.stdout).toMatch(/--language/);
  });

  it('exits 1 with an actionable message when no provider API key is set', async () => {
    const result = await runCli(
      [
        'summarize',
        '--input',
        bundlePath,
        '--provider',
        'claude',
        '--language',
        'en',
        '--detail',
        'brief',
      ],
      {
        // Explicitly unset API keys to ensure no accidental real call
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/ANTHROPIC_API_KEY is not set/);
  });

  it('exits 1 when --input is not provided', async () => {
    const result = await runCli([
      'summarize',
      '--provider',
      'claude',
      '--language',
      'en',
      '--detail',
      'brief',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/--input.*required|required.*--input/i);
  });

  it('exits 1 for a nonexistent input bundle file', async () => {
    const result = await runCli([
      'summarize',
      '--input',
      join(tempDir, 'does-not-exist.json'),
      '--provider',
      'claude',
      '--language',
      'en',
      '--detail',
      'brief',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found|error/i);
  });
});
