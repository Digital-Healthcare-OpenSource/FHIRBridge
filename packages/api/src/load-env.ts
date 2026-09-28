/**
 * Load `.env` for local (non-container) runs.
 *
 * dotenv's default only reads `<cwd>/.env`, but the documented flow puts `.env`
 * at the monorepo root while `pnpm --filter @fhirbridge/api dev|start|migrate`
 * runs with cwd = packages/api — so the root file was silently ignored and the
 * server refused to boot ("JWT_SECRET … received undefined").
 *
 * Lookup order (first file wins per key; real environment variables always win
 * because dotenv never overrides them):
 *   1. `<cwd>/.env`                  — previous behaviour, kept for compatibility
 *   2. `<monorepo root>/.env`        — only when that root has pnpm-workspace.yaml,
 *                                      so a container (/app) never climbs into `/`
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// src/load-env.ts and dist/load-env.js both sit two levels below the repo root.
const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Return the existing `.env` files to load, highest priority first. */
export function resolveEnvFiles(
  cwd: string = process.cwd(),
  repoRoot = DEFAULT_REPO_ROOT,
): string[] {
  const candidates = [join(resolve(cwd), '.env')];
  if (existsSync(join(repoRoot, 'pnpm-workspace.yaml'))) {
    candidates.push(join(repoRoot, '.env'));
  }
  return [...new Set(candidates)].filter((file) => existsSync(file));
}

const envFiles = resolveEnvFiles();
if (envFiles.length > 0) {
  config({ path: envFiles, quiet: true });
}
