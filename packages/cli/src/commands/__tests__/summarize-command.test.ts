/**
 * Tests for summarize-command — generates AI clinical summaries from FHIR bundles.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildProgram } from '../../index.js';
import { writeOutput } from '../../utils/file-writer.js';
import { error as logError } from '../../utils/logger.js';

// Real core pipeline, fake provider: ProviderGateway.summarize returns a canned summary.
const mockSummarize = vi.fn();
vi.mock('@fhirbridge/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@fhirbridge/core')>();
  return {
    ...actual,
    ProviderGateway: vi.fn().mockImplementation(() => ({ summarize: mockSummarize })),
  };
});

const FAKE_SUMMARY = {
  sections: [{ section: 'Conditions', content: 'Hypertension.', tokenCount: 10, resourceCount: 1 }],
  synthesis: 'Stable patient.',
  metadata: {
    generatedAt: '2026-01-01T00:00:00.000Z',
    provider: 'claude',
    model: 'claude-opus-5',
    totalTokens: 20,
    language: 'en',
    deidentified: true,
  },
};

// Silence logger output in tests
vi.mock('../../utils/logger.js', () => ({
  useStderrForStatus: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  print: vi.fn(),
  configureLogger: vi.fn(),
}));

// Mock prompts to avoid interactive TTY
vi.mock('../../prompts/provider-prompts.js', () => ({
  promptProviderOptions: vi.fn(async (opts: Record<string, unknown>) => ({
    provider: opts['provider'] ?? 'claude',
    language: opts['language'] ?? 'en',
    detail: opts['detail'] ?? 'standard',
  })),
}));

// Mock file writer
vi.mock('../../utils/file-writer.js', () => ({
  writeOutput: vi.fn(),
}));

// Mock config manager to return stable defaults
vi.mock('../../config/config-manager.js', () => ({
  loadConfig: vi.fn(() => ({
    defaultProvider: 'claude',
    defaultLanguage: 'en',
    profiles: {},
  })),
  CONFIG_PATH: '/tmp/.fhirbridgerc.json',
  saveConfig: vi.fn(),
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
  warnIfApiKeyInConfig: vi.fn(),
}));

const VALID_BUNDLE = JSON.stringify({
  resourceType: 'Bundle',
  type: 'collection',
  entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }],
});

describe('summarize-command registration', () => {
  it('registers the summarize subcommand', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('summarize');
  });

  it('has --provider option', () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === 'summarize');
    expect(cmd).toBeDefined();
    const optionNames = cmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--provider');
  });

  it('has --language option', () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === 'summarize');
    const optionNames = cmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--language');
  });

  it('has --detail option with default standard', () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === 'summarize');
    const detailOpt = cmd!.options.find((o) => o.long === '--detail');
    expect(detailOpt).toBeDefined();
    expect(detailOpt!.defaultValue).toBe('standard');
  });

  it('has --format option with default markdown', () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === 'summarize');
    const formatOpt = cmd!.options.find((o) => o.long === '--format');
    expect(formatOpt).toBeDefined();
    expect(formatOpt!.defaultValue).toBe('markdown');
  });

  it('has --input option', () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === 'summarize');
    const optionNames = cmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--input');
  });
});

describe('summarize-command parseAsync', () => {
  let tmpFile: string;
  const savedKey = process.env['ANTHROPIC_API_KEY'];

  beforeEach(() => {
    vi.clearAllMocks();
    mockSummarize.mockResolvedValue(FAKE_SUMMARY);
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-not-real';
    tmpFile = join(tmpdir(), `test-bundle-sum-${Date.now()}.json`);
    writeFileSync(tmpFile, VALID_BUNDLE);
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = savedKey;
    try {
      unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  });

  /** Run the command expecting process.exit(1); returns the logged error text. */
  async function expectExit1(args: string[]): Promise<string> {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      const program = buildProgram();
      program.exitOverride();
      await expect(program.parseAsync(['node', 'fhirbridge', ...args])).rejects.toThrow(
        'process.exit(1)',
      );
      return vi
        .mocked(logError)
        .mock.calls.map((c) => String(c[0]))
        .join('\n');
    } finally {
      exitSpy.mockRestore();
    }
  }

  it('writes a real Markdown summary produced by the core pipeline', async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'fhirbridge', 'summarize', '--input', tmpFile]);

    expect(mockSummarize).toHaveBeenCalledTimes(1);
    const [bundleArg, configArg] = mockSummarize.mock.calls[0];
    expect(bundleArg.resourceType).toBe('Bundle');
    expect(configArg.providerConfig.apiKey).toBe('sk-ant-test-not-real');
    expect(configArg.hmacSecret.length).toBeGreaterThanOrEqual(32);
    const written = vi.mocked(writeOutput).mock.calls[0][0];
    expect(written).toContain('Stable patient.');
    expect(written).not.toMatch(/placeholder/i);
  });

  it('emits a FHIR Composition for --format composition', async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync([
      'node',
      'fhirbridge',
      'summarize',
      '--input',
      tmpFile,
      '--format',
      'composition',
    ]);
    const written = JSON.parse(vi.mocked(writeOutput).mock.calls[0][0]);
    expect(written.resourceType).toBe('Composition');
  });

  it('fails with a clear message when the provider API key is missing', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const logged = await expectExit1(['summarize', '--input', tmpFile, '--provider', 'claude']);
    expect(logged).toMatch(/ANTHROPIC_API_KEY is not set/);
    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it('rejects unsupported languages and providers', async () => {
    expect(await expectExit1(['summarize', '--input', tmpFile, '--language', 'zh'])).toMatch(
      /Invalid --language "zh"/,
    );
    expect(await expectExit1(['summarize', '--input', tmpFile, '--provider', 'gemini'])).toMatch(
      /Invalid --provider "gemini"/,
    );
  });

  it('parses --provider claude without error', async () => {
    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync([
        'node',
        'fhirbridge',
        'summarize',
        '--input',
        tmpFile,
        '--provider',
        'claude',
      ]),
    ).resolves.toBeDefined();
  });

  it('parses --language vi without error', async () => {
    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync([
        'node',
        'fhirbridge',
        'summarize',
        '--input',
        tmpFile,
        '--language',
        'vi',
      ]),
    ).resolves.toBeDefined();
  });

  it('parses --detail brief without error', async () => {
    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync([
        'node',
        'fhirbridge',
        'summarize',
        '--input',
        tmpFile,
        '--detail',
        'brief',
      ]),
    ).resolves.toBeDefined();
  });

  it('parses --format composition without error', async () => {
    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync([
        'node',
        'fhirbridge',
        'summarize',
        '--input',
        tmpFile,
        '--format',
        'composition',
      ]),
    ).resolves.toBeDefined();
  });

  it('exits with error for missing --input', async () => {
    const program = buildProgram();
    program.exitOverride();

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error(`process.exit(${_code})`);
    });

    await expect(program.parseAsync(['node', 'fhirbridge', 'summarize'])).rejects.toThrow();

    exitSpy.mockRestore();
  });
});
