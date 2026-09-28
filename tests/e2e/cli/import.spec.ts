/**
 * E2E tests for `fhirbridge import` command.
 * Runs CLI as a real subprocess — no mocks. Every example mapping must produce
 * a NON-empty bundle that the `validate` command accepts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli, createTempDir, cleanTempDir, FIXTURES_CSV } from './cli-test-helper.js';

const CSV_FILE = join(FIXTURES_CSV, 'sample-patients.csv');
const MAPPING_FILE = join(FIXTURES_CSV, 'mapping-config.json');
const EXAMPLES = join(process.cwd(), 'examples');

/** checksum-valid synthetic RRNs present in examples/data/kr-hospital.csv */
const KR_RRNS = ['800101-1234560', '900202-2345679', '750505-1345673'];

interface BundleJson {
  resourceType: string;
  entry?: { fullUrl: string; resource: { resourceType: string } }[];
}

const countByType = (bundle: BundleJson) =>
  (bundle.entry ?? []).reduce<Record<string, number>>((acc, e) => {
    acc[e.resource.resourceType] = (acc[e.resource.resourceType] ?? 0) + 1;
    return acc;
  }, {});

let tempDir: string;

beforeAll(async () => {
  tempDir = await createTempDir();
});

afterAll(async () => {
  await cleanTempDir(tempDir);
});

describe('fhirbridge import — example mappings', () => {
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
  ])('%s + %s → non-empty bundle that passes `validate`', async (mapping, data, counts) => {
    const outputFile = join(tempDir, `${data}.bundle.json`);
    const result = await runCli([
      'import',
      '--file',
      join(EXAMPLES, 'data', data),
      '--mapping',
      join(EXAMPLES, 'column-mappings', mapping),
      '--output',
      outputFile,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(result.stdout).toContain(`Imported ${total} resources`);
    expect(result.stderr).not.toMatch(/⚠/); // no warnings for the shipped examples

    const bundle = JSON.parse(await readFile(outputFile, 'utf8')) as BundleJson;
    expect(bundle.resourceType).toBe('Bundle');
    expect(countByType(bundle)).toEqual(counts);

    const validation = await runCli(['validate', '--input', outputFile, '--format', 'json']);
    expect(validation.exitCode, validation.stderr).toBe(0);
    const out = validation.stdout;
    const report = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as {
      total: number;
      valid: number;
    };
    expect(report.total).toBe(total);
    expect(out).toContain(`All ${total} resources valid`);
  });

  it('KR example never writes a raw RRN (masked, or hashed with FHIRBRIDGE_HMAC_SECRET)', async () => {
    const args = (out: string) => [
      'import',
      '--file',
      join(EXAMPLES, 'data', 'kr-hospital.csv'),
      '--mapping',
      join(EXAMPLES, 'column-mappings', 'csv-korea-hospital.json'),
      '--output',
      out,
    ];
    const masked = join(tempDir, 'kr-masked.json');
    // No secret at all (a shell may export one) → masking path.
    expect(
      (await runCli(args(masked), { HMAC_SECRET: '', FHIRBRIDGE_HMAC_SECRET: '' })).exitCode,
    ).toBe(0);
    const maskedText = await readFile(masked, 'utf8');
    for (const rrn of KR_RRNS) expect(maskedText).not.toContain(rrn);
    expect(maskedText).toContain('######-*******');

    const hashed = join(tempDir, 'kr-hashed.json');
    const run = await runCli(args(hashed), {
      FHIRBRIDGE_HMAC_SECRET: 'e2e-hmac-secret-0123456789abcdef-xyz',
    });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toMatch(/RRN values HMAC-hashed: 3/);
    const hashedText = await readFile(hashed, 'utf8');
    for (const rrn of KR_RRNS) expect(hashedText).not.toContain(rrn);
    expect(hashedText).not.toContain('######-*******');
  });

  it('writes a pipeable bundle to stdout (status lines go to stderr)', async () => {
    const result = await runCli([
      'import',
      '--file',
      join(EXAMPLES, 'data', 'vn-hospital.csv'),
      '--mapping',
      join(EXAMPLES, 'column-mappings', 'csv-vneid-vn.json'),
      '--format',
      'ndjson',
    ]);
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(14);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(result.stderr).toMatch(/Imported 14 resources/);
  });
});

describe('fhirbridge import — legacy mapping + errors', () => {
  it('exits 0 and produces a non-empty FHIR Bundle from the legacy {mappings} fixture', async () => {
    const outputFile = join(tempDir, 'output-bundle.json');
    const result = await runCli([
      'import',
      '--file',
      CSV_FILE,
      '--mapping',
      MAPPING_FILE,
      '--output',
      outputFile,
      '--format',
      'json',
    ]);

    expect(result.exitCode).toBe(0);
    const bundle = JSON.parse(await readFile(outputFile, 'utf8')) as BundleJson;
    expect(bundle.resourceType).toBe('Bundle');
    expect(countByType(bundle)).toEqual({ Patient: 5 });
  });

  it('exits 1 and reports error when --file is omitted (non-TTY mode)', async () => {
    // Without --file, promptImportOptions will try TTY and fail (no TTY in subprocess)
    const result = await runCli([
      'import',
      '--mapping',
      MAPPING_FILE,
      '--output',
      join(tempDir, 'no-file-output.json'),
      '--format',
      'json',
    ]);
    expect(result.exitCode).toBe(1);
  });

  it('exits 1 with a pointer to examples when --mapping is omitted', async () => {
    const result = await runCli(['import', '--file', CSV_FILE]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/--mapping <path> is required.*examples\/column-mappings/);
  });

  it('exits 1 for a nonexistent input file', async () => {
    const result = await runCli([
      'import',
      '--file',
      join(tempDir, 'nonexistent.csv'),
      '--mapping',
      MAPPING_FILE,
      '--output',
      join(tempDir, 'output2.json'),
      '--format',
      'json',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found|error/i);
  });

  it('exits 1 for a nonexistent mapping file', async () => {
    const result = await runCli([
      'import',
      '--file',
      CSV_FILE,
      '--mapping',
      join(tempDir, 'nonexistent-mapping.json'),
      '--output',
      join(tempDir, 'output3.json'),
      '--format',
      'json',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found|error/i);
  });

  it('exits 1 and lists every problem for an invalid mapping', async () => {
    const bad = join(tempDir, 'bad-mapping.json');
    await writeFile(
      bad,
      JSON.stringify({
        fields: {
          'Patient.nmae.family': 'x',
          'Patient.gender': { column: 'g', transform: 'lower' },
        },
      }),
    );
    const result = await runCli(['import', '--file', CSV_FILE, '--mapping', bad]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('"nmae" is not a supported element of Patient');
    expect(result.stderr).toContain('unknown transform "lower"');
  });

  it('exits 1 and writes nothing when the mapping does not match the file', async () => {
    const outputFile = join(tempDir, 'mismatch.json');
    const result = await runCli([
      'import',
      '--file',
      join(FIXTURES_CSV, 'kr-sample-patients.csv'),
      '--mapping',
      join(EXAMPLES, 'column-mappings', 'csv-vneid-vn.json'),
      '--output',
      outputFile,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/patientId column "VNEID" was not found/);
    await expect(readFile(outputFile, 'utf8')).rejects.toThrow();
  });
});
