#!/usr/bin/env node
/**
 * FHIRBridge one-command setup — cross-platform (Linux / macOS / Windows), no
 * dependencies beyond Node itself.
 *
 *   pnpm run setup                 # .env + install + build
 *   node scripts/setup.mjs --env-only   # only create/repair .env (e.g. for Docker)
 *
 * What it does:
 *   1. Checks Node >= 20.
 *   2. Creates `.env` from `.env.example` — or repairs an existing one — filling
 *      in random JWT_SECRET / HMAC_SECRET, an API key for the web UI and random
 *      Postgres / Redis passwords. Values you already set are never touched.
 *   3. Installs dependencies (if needed) and builds every package.
 *
 * Idempotent: running it again keeps your secrets and API key.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fchmodSync,
  ftruncateSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env');
const ENV_EXAMPLE = join(ROOT, '.env.example');

const args = new Set(process.argv.slice(2));
const ENV_ONLY = args.has('--env-only');
const SKIP_BUILD = ENV_ONLY || args.has('--no-build');

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const log = (msg) => console.log(`${paint('32', '[setup]')} ${msg}`);
const warn = (msg) => console.log(`${paint('33', '[warn]')}  ${msg}`);
const fail = (msg) => {
  console.error(`${paint('31', '[error]')} ${msg}`);
  process.exit(1);
};

// Same markers the API rejects at boot (packages/api/src/config.ts).
const PLACEHOLDER =
  /change-this|changeme|change-me|your-secret|your_secret|placeholder|example|secret-here/i;

const hex = (bytes) => randomBytes(bytes).toString('hex');

/** Generators for values that must be unique per installation. */
const GENERATED = {
  JWT_SECRET: () => hex(48),
  HMAC_SECRET: () => hex(48),
  API_KEYS: () => `fhb_${randomBytes(24).toString('base64url')}`,
  POSTGRES_PASSWORD: () => hex(24),
  REDIS_PASSWORD: () => hex(24),
};

/** Keys whose current value must be replaced: missing, empty or a placeholder. */
function needsValue(value) {
  return value === undefined || value.trim() === '' || PLACEHOLDER.test(value);
}

/** Replace (or append) `KEY=value` in dotenv text, preserving everything else. */
function setVar(text, key, value) {
  const line = new RegExp(`^${key}=.*$`, 'm');
  if (line.test(text)) return text.replace(line, `${key}=${value}`);
  return `${text.replace(/\n?$/, '\n')}${key}=${value}\n`;
}

function readVar(text, key) {
  const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim() : undefined;
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) fail(`Node.js >= 20 is required (found ${process.version}).`);
}

/** Read a file, or undefined when it does not exist (no check-then-use race). */
function readIfExists(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * Write .env through one file descriptor: created exclusively ('wx') when new,
 * and owner-only (0600) in both cases — it holds the installation's secrets.
 */
function writeEnvFile(text, create) {
  const fd = openSync(ENV_FILE, create ? 'wx' : 'r+', 0o600);
  try {
    try {
      fchmodSync(fd, 0o600); // no-op on Windows
    } catch {
      /* ignore */
    }
    ftruncateSync(fd, 0);
    writeSync(fd, text, 0);
  } finally {
    closeSync(fd);
  }
}

function prepareEnv() {
  const existing = readIfExists(ENV_FILE);
  const created = existing === undefined;
  let text = existing ?? readIfExists(ENV_EXAMPLE);
  if (text === undefined) fail('.env.example not found — run from a full checkout.');

  const changed = [];
  for (const [key, generate] of Object.entries(GENERATED)) {
    if (needsValue(readVar(text, key))) {
      text = setVar(text, key, generate());
      changed.push(key);
    }
  }

  // Keep the commented connection-string hints in sync with the generated passwords
  // so enabling Postgres / Redis is just "uncomment the line".
  const pgPassword = readVar(text, 'POSTGRES_PASSWORD');
  const redisPassword = readVar(text, 'REDIS_PASSWORD');
  text = text
    .replace(
      /^# DATABASE_URL=postgresql:\/\/([^:]+):[^@]*@/m,
      (_m, user) => `# DATABASE_URL=postgresql://${user}:${pgPassword}@`,
    )
    .replace(/^# REDIS_URL=redis:\/\/:[^@]*@/m, `# REDIS_URL=redis://:${redisPassword}@`);

  writeEnvFile(text, created);

  if (created) log(`Created .env with fresh secrets (${changed.join(', ')}).`);
  else if (changed.length > 0) log(`Filled in missing values in .env: ${changed.join(', ')}.`);
  else log('.env already configured — kept your existing values.');
}

function run(command, commandArgs) {
  log(`${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32', // resolve pnpm.cmd on Windows
  });
  if (result.error) fail(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0)
    fail(`${command} ${commandArgs.join(' ')} failed (exit ${result.status}).`);
}

checkNode();
prepareEnv();

if (!SKIP_BUILD) {
  if (!existsSync(join(ROOT, 'node_modules', '.modules.yaml'))) {
    run('pnpm', ['install', '--frozen-lockfile']);
  }
  run('pnpm', ['build']);
}

console.log('');
log(paint('1', 'Setup complete.'));
console.log('');
// The key itself is never printed (terminal scrollback / CI logs): point at it.
console.log(`  Your API key: the ${paint('36', 'API_KEYS=')} line in ${ENV_FILE}`);
console.log('');
if (ENV_ONLY) {
  console.log('  Next:  docker compose up --build   → http://localhost:8080');
} else {
  console.log('  Next:  pnpm start                  → http://localhost:8080');
}
console.log('         Open Settings in the web UI and paste that API key.');
console.log('');
console.log('  Optional: AI summaries need ANTHROPIC_API_KEY or OPENAI_API_KEY in .env —');
console.log('  read the data-residency notes in README (VN / KR / JP) before enabling them.');
console.log('');
if (!SKIP_BUILD && process.platform !== 'win32') {
  warn('Keep .env private: it holds your secrets (permissions set to 600).');
}
