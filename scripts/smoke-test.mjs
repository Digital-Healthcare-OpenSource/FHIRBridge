#!/usr/bin/env node
/**
 * Smoke test — proves a running FHIRBridge works end to end:
 * health → HIS connection → export → poll → download a valid FHIR Bundle.
 *
 *   pnpm demo                    # in one terminal
 *   pnpm smoke                   # in another (defaults match `pnpm demo`)
 *
 *   # Docker: docker compose --profile demo up -d --build
 *   node scripts/smoke-test.mjs --his http://demo-his:8090/fhir
 *
 * Options (all optional):
 *   --url <base>        web/API origin            (default http://127.0.0.1:${WEB_PORT:-8080})
 *   --his <fhir base>   FHIR server to export from (default http://localhost:8090/fhir)
 *   --patient <id>      patient to export          (default demo-vn-001)
 *   --key <api key>     API key                    (default: first entry of API_KEYS in .env)
 *
 * Exits non-zero with a readable message on the first failing step.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readDotenv(file) {
  if (!existsSync(file)) return {};
  const vars = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const dotenv = readDotenv(join(ROOT, '.env'));
const BASE = arg('url', `http://127.0.0.1:${process.env.WEB_PORT || dotenv.WEB_PORT || 8080}`);
const HIS = arg('his', 'http://localhost:8090/fhir');
const PATIENT = arg('patient', 'demo-vn-001');
const KEY = arg('key', (process.env.API_KEYS || dotenv.API_KEYS || '').split(',')[0].trim());

const API = `${BASE.replace(/\/+$/, '')}/api/v1`;

function fail(step, detail) {
  console.error(`✖ ${step}: ${detail}`);
  process.exit(1);
}

async function call(step, path, init = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json', ...init.headers },
    });
  } catch (err) {
    fail(step, `cannot reach ${API} (${err.cause?.code ?? err.message}) — is FHIRBridge running?`);
  }
  const text = await res.text();
  if (!res.ok) fail(step, `HTTP ${res.status} ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    fail(step, `expected JSON, got: ${text.slice(0, 120)}`);
  }
}

if (!KEY) fail('setup', 'no API key — run `pnpm run setup` or pass --key');

const health = await call('health', '/health');
console.log(`✔ health: ${health.status} (version ${health.version})`);

const connection = await call('HIS connection', '/connectors/test', {
  method: 'POST',
  body: JSON.stringify({ type: 'fhir-endpoint', config: { baseUrl: HIS } }),
});
if (!connection.connected) fail('HIS connection', `${HIS}: ${connection.error ?? 'not connected'}`);
console.log(`✔ HIS connection: ${HIS} (FHIR ${connection.serverVersion ?? '?'})`);

const started = await call('start export', '/export', {
  method: 'POST',
  body: JSON.stringify({
    patientId: PATIENT,
    connectorConfig: { type: 'fhir-endpoint', baseUrl: HIS },
  }),
});
console.log(`✔ export started: ${started.exportId}`);

let status;
for (let attempt = 0; attempt < 60; attempt++) {
  status = await call('export status', `/export/${started.exportId}/status`);
  if (status.status !== 'processing') break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (status.status !== 'complete') {
  fail('export status', `${status.status}${status.error ? ` — ${status.error}` : ''}`);
}

const bundle = await call('download', `/export/${started.exportId}/download?format=json`);
const types = (bundle.entry ?? []).map((entry) => entry.resource?.resourceType);
if (bundle.resourceType !== 'Bundle' || !types.includes('Patient')) {
  fail('download', 'response is not a FHIR Bundle containing a Patient');
}
console.log(`✔ downloaded Bundle: ${types.length} resources (${[...new Set(types)].join(', ')})`);
console.log('\nSmoke test passed — FHIRBridge is working.');
