/**
 * resolveEnvFiles — the API must find the monorepo-root `.env` even when pnpm
 * runs it with cwd = packages/api, without ever climbing out of the repo.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveEnvFiles } from '../load-env.js';

let root: string;
let pkgDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fhirbridge-env-'));
  pkgDir = join(root, 'packages', 'api');
  mkdirSync(pkgDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveEnvFiles', () => {
  it('finds the repo-root .env when cwd is the package directory', () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    writeFileSync(join(root, '.env'), 'JWT_SECRET=x\n');
    expect(resolveEnvFiles(pkgDir, root)).toEqual([join(root, '.env')]);
  });

  it('gives a package-local .env priority over the root one', () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), '');
    writeFileSync(join(root, '.env'), '');
    writeFileSync(join(pkgDir, '.env'), '');
    expect(resolveEnvFiles(pkgDir, root)).toEqual([join(pkgDir, '.env'), join(root, '.env')]);
  });

  it('ignores a root .env when the root is not a pnpm workspace (e.g. container /app)', () => {
    writeFileSync(join(root, '.env'), '');
    expect(resolveEnvFiles(pkgDir, root)).toEqual([]);
  });

  it('does not list the same file twice when cwd is the repo root', () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), '');
    writeFileSync(join(root, '.env'), '');
    expect(resolveEnvFiles(root, root)).toEqual([join(root, '.env')]);
  });
});
