/**
 * Tests for validate-command — validates FHIR bundle JSON files.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildProgram } from '../../index.js';

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

const VALID_BUNDLE = JSON.stringify({
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      resource: {
        resourceType: 'Patient',
        id: 'patient-1',
        name: [{ family: 'Doe', given: ['John'] }],
        birthDate: '1980-01-01',
        gender: 'male',
      },
    },
  ],
});

const EMPTY_BUNDLE = JSON.stringify({
  resourceType: 'Bundle',
  type: 'collection',
  entry: [],
});

describe('validate-command', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `test-bundle-${Date.now()}.json`);
  });

  afterEach(() => {
    try {
      unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  });

  it('exits 0 for a valid bundle', async () => {
    writeFileSync(tmpFile, VALID_BUNDLE);
    const program = buildProgram();
    program.exitOverride();

    // Should not throw
    await expect(
      program.parseAsync(['node', 'fhirbridge', 'validate', '--input', tmpFile]),
    ).resolves.toBeDefined();
  });

  it('exits 1 for a non-existent file', async () => {
    const program = buildProgram();
    program.exitOverride();

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error(`process.exit(${_code})`);
    });

    await expect(
      program.parseAsync(['node', 'fhirbridge', 'validate', '--input', '/nonexistent/path.json']),
    ).rejects.toThrow();

    exitSpy.mockRestore();
  });

  it('parses an empty bundle without error', async () => {
    writeFileSync(tmpFile, EMPTY_BUNDLE);
    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'fhirbridge', 'validate', '--input', tmpFile]),
    ).resolves.toBeDefined();
  });

  it('supports --format json output', async () => {
    writeFileSync(tmpFile, VALID_BUNDLE);
    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync([
        'node',
        'fhirbridge',
        'validate',
        '--input',
        tmpFile,
        '--format',
        'json',
      ]),
    ).resolves.toBeDefined();
  });

  it('rejects non-Bundle JSON', async () => {
    writeFileSync(tmpFile, JSON.stringify({ resourceType: 'Patient', id: 'p1' }));
    const program = buildProgram();
    program.exitOverride();

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error(`process.exit(${_code})`);
    });

    await expect(
      program.parseAsync(['node', 'fhirbridge', 'validate', '--input', tmpFile]),
    ).rejects.toThrow();

    exitSpy.mockRestore();
  });
});
