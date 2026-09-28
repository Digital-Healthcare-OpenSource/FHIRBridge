/**
 * Tests for import-command — CSV/Excel + column mapping → FHIR bundle.
 * Uses the real core importer with the example mappings/data (no connector
 * stubs: the old stubs returned nothing, which is how empty bundles slipped by).
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { containsRrn, validateResource } from '@fhirbridge/core';
import type { Bundle } from '@fhirbridge/types';
import { buildProgram } from '../../index.js';
import { writeOutput } from '../../utils/file-writer.js';
import { error, warn } from '../../utils/logger.js';

// Silence logger output in tests
vi.mock('../../utils/logger.js', () => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  print: vi.fn(),
  configureLogger: vi.fn(),
}));

// Prompts: pass explicit options through (no TTY in tests)
vi.mock('../../prompts/import-prompts.js', () => ({
  promptImportOptions: vi.fn(async (existing: Record<string, unknown>) => ({
    filePath: existing['filePath'],
    mappingPath: existing['mappingPath'],
    outputPath: existing['outputPath'] ?? '',
    format: existing['format'] ?? 'json',
  })),
}));

// Capture output instead of writing files
vi.mock('../../utils/file-writer.js', () => ({
  writeOutput: vi.fn(),
}));

const REPO_ROOT = resolve(__dirname, '../../../../..');
const MAPPINGS = join(REPO_ROOT, 'examples/column-mappings');
const DATA = join(REPO_ROOT, 'examples/data');
const LEGACY_MAPPING = join(REPO_ROOT, 'tests/fixtures/csv/mapping-config.json');
const LEGACY_CSV = join(REPO_ROOT, 'tests/fixtures/csv/sample-patients.csv');

let tmp: string;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fhirbridge-cli-import-'));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const savedHmacSecret = process.env['HMAC_SECRET'];

beforeEach(() => {
  vi.clearAllMocks();
  // A developer shell / CI step may export HMAC_SECRET — tests pick secrets explicitly.
  delete process.env['FHIRBRIDGE_HMAC_SECRET'];
  delete process.env['HMAC_SECRET'];
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  stderrSpy.mockRestore();
  if (savedHmacSecret === undefined) delete process.env['HMAC_SECRET'];
  else process.env['HMAC_SECRET'] = savedHmacSecret;
});

/** Run `fhirbridge import ...`; returns exit code (0 when the action completes). */
async function runImport(args: string[]): Promise<number> {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  try {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'fhirbridge', 'import', ...args]);
    return 0;
  } catch (err) {
    const match = /process\.exit\((\d+)\)/.exec((err as Error).message);
    if (match) return Number(match[1]);
    throw err;
  } finally {
    exitSpy.mockRestore();
  }
}

/** The bundle passed to writeOutput by the last run. */
function writtenBundle(): Bundle {
  const calls = vi.mocked(writeOutput).mock.calls;
  expect(calls).toHaveLength(1);
  return JSON.parse(calls[0]![0]) as Bundle;
}

const errorText = () =>
  vi
    .mocked(error)
    .mock.calls.map((c) => c[0])
    .join('\n');

function countByType(bundle: Bundle): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of bundle.entry ?? []) {
    const t = e.resource!.resourceType;
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

describe('import-command registration', () => {
  const importCmd = () => buildProgram().commands.find((c) => c.name() === 'import')!;

  it('registers the import subcommand with its options', () => {
    const longs = importCmd().options.map((o) => o.long);
    expect(longs).toEqual(
      expect.arrayContaining(['--file', '--mapping', '--sheet', '--output', '--format']),
    );
  });

  it('--format defaults to json and --resource-type (legacy flat mappings) to Patient', () => {
    const cmd = importCmd();
    expect(cmd.options.find((o) => o.long === '--format')!.defaultValue).toBe('json');
    expect(cmd.options.find((o) => o.long === '--resource-type')!.defaultValue).toBe('Patient');
  });
});

describe('import-command — example mappings produce non-empty, valid bundles', () => {
  it.each([
    [
      'csv-generic-hl7.json',
      'generic-hl7.csv',
      { Patient: 3, Encounter: 4, Condition: 4, Observation: 3 },
    ],
    [
      'csv-korea-hospital.json',
      'kr-hospital.csv',
      { Patient: 3, Encounter: 4, Condition: 4, Observation: 3 },
    ],
    [
      'csv-vneid-vn.json',
      'vn-hospital.csv',
      { Patient: 3, Encounter: 4, Condition: 4, Observation: 3 },
    ],
    ['excel-japan-clinic.json', 'jp-clinic.xlsx', { Patient: 3, Encounter: 4, Condition: 4 }],
  ])('%s + %s', async (mapping, data, counts) => {
    const code = await runImport([
      '--file',
      join(DATA, data),
      '--mapping',
      join(MAPPINGS, mapping),
    ]);
    expect(code).toBe(0);
    const bundle = writtenBundle();
    expect(bundle.resourceType).toBe('Bundle');
    expect(countByType(bundle)).toEqual(counts);
    for (const e of bundle.entry!) expect(validateResource(e.resource).valid).toBe(true);
    expect(vi.mocked(warn)).not.toHaveBeenCalled();
  });

  it('writes NDJSON (one resource per line) with --format ndjson', async () => {
    const code = await runImport([
      '--file',
      join(DATA, 'vn-hospital.csv'),
      '--mapping',
      join(MAPPINGS, 'csv-vneid-vn.json'),
      '--format',
      'ndjson',
    ]);
    expect(code).toBe(0);
    const lines = vi.mocked(writeOutput).mock.calls[0]![0].trim().split('\n');
    expect(lines).toHaveLength(14);
    expect(JSON.parse(lines[0]!).resourceType).toBe('Patient');
  });

  it('KR: RRNs are masked without a secret and hashed with FHIRBRIDGE_HMAC_SECRET', async () => {
    const args = [
      '--file',
      join(DATA, 'kr-hospital.csv'),
      '--mapping',
      join(MAPPINGS, 'csv-korea-hospital.json'),
    ];
    expect(await runImport(args)).toBe(0);
    const masked = vi.mocked(writeOutput).mock.calls[0]![0];
    expect(containsRrn(masked)).toBe(false);
    expect(masked).toContain('######-*******');

    vi.mocked(writeOutput).mockClear();
    process.env['FHIRBRIDGE_HMAC_SECRET'] = 'cli-test-hmac-secret-0123456789abcdef';
    expect(await runImport(args)).toBe(0);
    const hashed = vi.mocked(writeOutput).mock.calls[0]![0];
    expect(containsRrn(hashed)).toBe(false);
    expect(hashed).not.toContain('######-*******');
  });

  it('KR: HMAC_SECRET (same variable as the API) also hashes RRNs', async () => {
    process.env['HMAC_SECRET'] = 'api-style-hmac-secret-0123456789abcdef';
    const code = await runImport([
      '--file',
      join(DATA, 'kr-hospital.csv'),
      '--mapping',
      join(MAPPINGS, 'csv-korea-hospital.json'),
    ]);
    expect(code).toBe(0);
    const hashed = vi.mocked(writeOutput).mock.calls[0]![0];
    expect(containsRrn(hashed)).toBe(false);
    expect(hashed).not.toContain('######-*******');
  });

  it('--sheet reads every type from one Excel sheet', async () => {
    const mappingFile = join(tmp, 'jp-patients.json');
    writeFileSync(
      mappingFile,
      JSON.stringify({ patientId: '患者番号', fields: { 'Patient.name.family': '姓' } }),
    );
    const code = await runImport([
      '--file',
      join(DATA, 'jp-clinic.xlsx'),
      '--mapping',
      mappingFile,
      '--sheet',
      '患者',
    ]);
    expect(code).toBe(0);
    expect(countByType(writtenBundle())).toEqual({ Patient: 3 });
  });

  it('still accepts the legacy {mappings: [...]} fixture', async () => {
    expect(await runImport(['--file', LEGACY_CSV, '--mapping', LEGACY_MAPPING])).toBe(0);
    const bundle = writtenBundle();
    expect(countByType(bundle)).toEqual({ Patient: 5 });
    expect(bundle.entry![0]!.resource).toMatchObject({
      identifier: [{ value: 'P001' }],
      name: [{ family: 'Smith', given: ['John'] }],
      gender: 'male',
      birthDate: '1985-03-15',
    });
  });

  it('accepts the legacy flat {column: fhirPath} format', async () => {
    const flat = join(tmp, 'flat.json');
    writeFileSync(flat, JSON.stringify({ patient_id: 'id', last_name: 'name[0].family' }));
    expect(await runImport(['--file', LEGACY_CSV, '--mapping', flat])).toBe(0);
    expect(countByType(writtenBundle())).toEqual({ Patient: 5 });
  });
});

describe('import-command — errors exit non-zero with clear messages', () => {
  it('requires --mapping (non-TTY)', async () => {
    expect(await runImport(['--file', LEGACY_CSV])).toBe(1);
    expect(errorText()).toMatch(
      /--mapping <path> is required for CSV\/Excel import\. Start from one of examples\/column-mappings/,
    );
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it('reports every problem in an invalid mapping', async () => {
    const bad = join(tmp, 'bad.json');
    writeFileSync(
      bad,
      JSON.stringify({
        timezone: 'Asia/Seoul',
        fields: {
          'Patient.nmae.family': 'x',
          'Patient.gender': { column: 'g', transform: 'lower' },
        },
      }),
    );
    expect(await runImport(['--file', LEGACY_CSV, '--mapping', bad])).toBe(1);
    const text = errorText();
    expect(text).toContain(`Invalid mapping file ${bad}:`);
    expect(text).toContain(
      'fields["Patient.nmae.family"]: "nmae" is not a supported element of Patient',
    );
    expect(text).toContain('fields["Patient.gender"].transform: unknown transform "lower"');
    expect(text).toContain('"timezone" must be a UTC offset');
  });

  it('reports invalid JSON and missing files', async () => {
    const notJson = join(tmp, 'broken.json');
    writeFileSync(notJson, '{ "fields": ');
    expect(await runImport(['--file', LEGACY_CSV, '--mapping', notJson])).toBe(1);
    expect(errorText()).toMatch(/is not valid JSON/);

    vi.mocked(error).mockClear();
    expect(await runImport(['--file', LEGACY_CSV, '--mapping', join(tmp, 'nope.json')])).toBe(1);
    expect(errorText()).toMatch(/Mapping file not found/);

    vi.mocked(error).mockClear();
    expect(await runImport(['--file', join(tmp, 'nope.csv'), '--mapping', LEGACY_MAPPING])).toBe(1);
    expect(errorText()).toMatch(/Input file not found/);
  });

  it('fails when the mapping does not match the file header at all', async () => {
    const code = await runImport([
      '--file',
      LEGACY_CSV,
      '--mapping',
      join(MAPPINGS, 'csv-korea-hospital.json'),
    ]);
    expect(code).toBe(1);
    expect(errorText()).toMatch(/patientId column "환자ID" was not found in the header row/);
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it('warns and exits non-zero when no resources are produced', async () => {
    // columns match, but every Patient lacks a family name → all dropped
    const noFamily = join(tmp, 'no-family.json');
    writeFileSync(noFamily, JSON.stringify({ fields: { 'Patient.name.given': 'first_name' } }));
    expect(await runImport(['--file', LEGACY_CSV, '--mapping', noFamily])).toBe(1);
    expect(errorText()).toMatch(
      /No FHIR resources were produced from 5 row\(s\) — nothing written/,
    );
    expect(vi.mocked(warn).mock.calls[0]![0]).toMatch(
      /^row 2: Patient dropped — name\[0\]\.family/,
    );
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it('rejects an unsupported --format', async () => {
    expect(
      await runImport(['--file', LEGACY_CSV, '--mapping', LEGACY_MAPPING, '--format', 'xml']),
    ).toBe(1);
    expect(errorText()).toMatch(/Unsupported --format "xml"/);
  });
});
