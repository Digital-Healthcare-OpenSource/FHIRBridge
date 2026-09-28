/**
 * Tests for export-command — exports patient data from a FHIR endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildProgram } from '../../index.js';

// Mock @fhirbridge/core connectors để tránh real network calls trong unit tests
vi.mock('@fhirbridge/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@fhirbridge/core')>();
  return {
    ...actual,
    // FhirEndpointConnector stub — trả về empty async iterable
    FhirEndpointConnector: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      fetchPatientData: vi.fn().mockReturnValue(
        // async generator rỗng
        (async function* () {})(),
      ),
      testConnection: vi
        .fn()
        .mockResolvedValue({ connected: true, checkedAt: new Date().toISOString() }),
    })),
  };
});

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

// Mock prompts to avoid interactive TTY in tests
vi.mock('../../prompts/export-prompts.js', () => ({
  promptExportOptions: vi.fn(async (opts: Record<string, unknown>) => ({
    endpoint: opts['endpoint'] ?? 'http://localhost:8080/fhir',
    patientId: opts['patientId'] ?? 'patient-1',
    format: opts['format'] ?? 'json',
    outputPath: opts['outputPath'] ?? null,
  })),
}));

// Mock progress display
vi.mock('../../formatters/progress-display.js', () => ({
  createProgress: vi.fn(() => ({
    update: vi.fn(),
    increment: vi.fn(),
    stop: vi.fn(),
  })),
}));

// Mock file writer
vi.mock('../../utils/file-writer.js', () => ({
  writeOutput: vi.fn(),
}));

// Mock profile store
vi.mock('../../config/profile-store.js', () => ({
  requireProfile: vi.fn((name: string) => ({
    type: 'fhir-endpoint',
    baseUrl: `http://mocked-${name}.fhir.org`,
  })),
}));

describe('export-command registration', () => {
  it('registers the export subcommand', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('export');
  });

  it('export command has --patient-id option', () => {
    const program = buildProgram();
    const exportCmd = program.commands.find((c) => c.name() === 'export');
    expect(exportCmd).toBeDefined();
    const optionNames = exportCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--patient-id');
  });

  it('export command has --endpoint option', () => {
    const program = buildProgram();
    const exportCmd = program.commands.find((c) => c.name() === 'export');
    const optionNames = exportCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--endpoint');
  });

  it('export command has --format option with default json', () => {
    const program = buildProgram();
    const exportCmd = program.commands.find((c) => c.name() === 'export');
    const formatOpt = exportCmd!.options.find((o) => o.long === '--format');
    expect(formatOpt).toBeDefined();
    expect(formatOpt!.defaultValue).toBe('json');
  });

  it('export command has --profile option', () => {
    const program = buildProgram();
    const exportCmd = program.commands.find((c) => c.name() === 'export');
    const optionNames = exportCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--profile');
  });

  it('export command has --output option', () => {
    const program = buildProgram();
    const exportCmd = program.commands.find((c) => c.name() === 'export');
    const optionNames = exportCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--output');
  });
});

describe('export-command parseAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses --patient-id and --endpoint without error', async () => {
    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync([
        'node',
        'fhirbridge',
        'export',
        '--patient-id',
        'p123',
        '--endpoint',
        'http://hapi.fhir.org/baseR4',
      ]),
    ).resolves.toBeDefined();
  });

  it('parses --format ndjson without error', async () => {
    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'fhirbridge', 'export', '--format', 'ndjson']),
    ).resolves.toBeDefined();
  });

  it('parses --profile option without error', async () => {
    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'fhirbridge', 'export', '--profile', 'local-hapi']),
    ).resolves.toBeDefined();
  });

  it('parses --include-summary flag without error', async () => {
    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'fhirbridge', 'export', '--include-summary']),
    ).resolves.toBeDefined();
  });
});
