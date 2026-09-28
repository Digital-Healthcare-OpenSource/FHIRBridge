#!/usr/bin/env node
/**
 * `pnpm start` — run FHIRBridge (API + web UI) from a built checkout with one
 * command, cross-platform and dependency-free.
 *
 *   API     node packages/api/dist/index.js        (PORT, default 3001)
 *   Web UI  static packages/web/dist + /api proxy  (WEB_HOST:WEB_PORT, default 127.0.0.1:8080)
 *
 * The browser only talks to the web port; `/api/*` is proxied to the API so the
 * UI and API share one origin (no CORS setup needed). Settings come from `.env`
 * (created by `pnpm run setup`); real environment variables win.
 *
 * `pnpm demo` (= `--demo`) additionally starts the synthetic Demo HIS
 * (examples/demo-his) on 127.0.0.1:8090 and allowlists exactly that host:port,
 * so the export flow can be tried with no hospital system and no internet.
 *
 * This is a convenience runner for a single machine. For a LAN / production
 * deployment put a TLS reverse proxy in front (docs/operations/reverse-proxy.md)
 * or use `docker compose up`.
 */

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_ENTRY = join(ROOT, 'packages', 'api', 'dist', 'index.js');
const WEB_DIST = resolve(ROOT, 'packages', 'web', 'dist');
const ENV_FILE = join(ROOT, '.env');

const log = (msg) => console.log(`[start] ${msg}`);
const fail = (msg) => {
  console.error(`[start] ${msg}`);
  process.exit(1);
};

/** Minimal dotenv reader (KEY=VALUE lines) — only for the ports this script needs. */
function readDotenv(file) {
  if (!existsSync(file)) return {};
  const vars = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) vars[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

const dotenv = readDotenv(ENV_FILE);
const setting = (key, fallback) => process.env[key] || dotenv[key] || fallback;

const API_PORT = Number(setting('PORT', '3001'));
const WEB_PORT = Number(setting('WEB_PORT', '8080'));
const WEB_HOST = setting('WEB_HOST', '127.0.0.1');
const DEMO = process.argv.includes('--demo');
const DEMO_HIS_PORT = Number(setting('DEMO_HIS_PORT', '8090'));

if (!existsSync(ENV_FILE) && !process.env.JWT_SECRET) {
  fail('No .env found. Run `pnpm run setup` first (it generates secrets and builds everything).');
}
if (!existsSync(API_ENTRY) || !existsSync(join(WEB_DIST, 'index.html'))) {
  fail('Build output missing. Run `pnpm run setup` (or `pnpm build`) first.');
}

// ── Static file + proxy gateway ─────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Mirrors the API's helmet policy, minus upgrade-insecure-requests so the UI
// also works over plain http on localhost / a test LAN.
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; " +
    "object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function sendFile(req, res, file) {
  const isAsset = file.startsWith(join(WEB_DIST, 'assets') + sep);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }
  // Path traversal guard: the resolved file must stay inside WEB_DIST.
  const file = resolve(WEB_DIST, '.' + normalize('/' + decoded));
  if (file !== WEB_DIST && !file.startsWith(WEB_DIST + sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (existsSync(file) && statSync(file).isFile()) return sendFile(req, res, file);
  // SPA fallback: client-side routes (no file extension) get index.html.
  if (!extname(decoded)) return sendFile(req, res, join(WEB_DIST, 'index.html'));
  res.writeHead(404, SECURITY_HEADERS);
  res.end('Not found');
}

function proxyToApi(req, res) {
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: API_PORT,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        'x-forwarded-for': req.socket.remoteAddress ?? '',
        'x-forwarded-proto': 'http',
        'x-forwarded-host': req.headers.host ?? '',
      },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res); // streamed — NDJSON exports are never buffered
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(
      JSON.stringify({ statusCode: 502, error: 'Bad Gateway', message: 'API is not reachable' }),
    );
  });
  req.pipe(upstream);
}

const gateway = http.createServer((req, res) => {
  const pathname = (req.url ?? '/').split('?')[0];
  if (pathname === '/api' || pathname.startsWith('/api/')) return proxyToApi(req, res);
  return serveStatic(req, res, pathname);
});

// ── Process management ──────────────────────────────────────────────────────

const apiEnv = { ...process.env };
// The gateway is always the API's front door here and forwards the client IP;
// trusting loopback keeps per-client rate limiting / audit IPs correct.
if (['', 'false'].includes(setting('TRUST_PROXY', '').toLowerCase())) {
  apiEnv.TRUST_PROXY = 'loopback';
}
let demoHis = null;
if (DEMO) {
  const { createDemoHis } = await import('../examples/demo-his/server.mjs');
  demoHis = createDemoHis();
  await new Promise((done, reject) => {
    demoHis.once('error', reject);
    demoHis.listen(DEMO_HIS_PORT, '127.0.0.1', done);
  }).catch((err) => fail(`Demo HIS could not listen on port ${DEMO_HIS_PORT}: ${err.message}`));
  // Open exactly the demo port through the SSRF guard — nothing else on localhost.
  const existing = setting('CONNECTOR_ALLOWED_HOSTS', '');
  apiEnv.CONNECTOR_ALLOWED_HOSTS = [existing, `localhost:${DEMO_HIS_PORT}`]
    .filter(Boolean)
    .join(',');
  log(`Demo HIS (synthetic data) listening on http://localhost:${DEMO_HIS_PORT}/fhir`);
}

log(`Starting API on port ${API_PORT}...`);
const api = spawn(process.execPath, [API_ENTRY], { cwd: ROOT, stdio: 'inherit', env: apiEnv });

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  gateway.close();
  demoHis?.close();
  if (api.exitCode === null) api.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}

api.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`[start] API exited with code ${code} — see the error above.`);
    shutdown(code ?? 1);
  } else {
    process.exit(code ?? 0);
  }
});
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

gateway.on('error', (err) => {
  console.error(`[start] Web UI could not listen on ${WEB_HOST}:${WEB_PORT}: ${err.message}`);
  console.error('[start] Set WEB_PORT in .env to a free port.');
  shutdown(1);
});

/** Poll the API health endpoint so the banner only prints once it is usable. */
async function waitForApi(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !shuttingDown) {
    const ok = await new Promise((done) => {
      http
        .get({ host: '127.0.0.1', port: API_PORT, path: '/api/v1/health', timeout: 2000 }, (r) => {
          r.resume();
          done(r.statusCode === 200);
        })
        .on('error', () => done(false))
        .on('timeout', function onTimeout() {
          this.destroy();
          done(false);
        });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

gateway.listen(WEB_PORT, WEB_HOST, async () => {
  const ready = await waitForApi();
  if (shuttingDown) return;
  const shownHost = WEB_HOST === '0.0.0.0' ? 'localhost' : WEB_HOST;
  console.log('');
  console.log(`  FHIRBridge is running  →  http://${shownHost}:${WEB_PORT}`);
  console.log(`  API health             →  http://${shownHost}:${WEB_PORT}/api/v1/health`);
  console.log('  Sign in: Settings → paste the API key from .env (API_KEYS)');
  if (DEMO) {
    console.log('');
    console.log(`  Demo HIS FHIR URL      →  http://localhost:${DEMO_HIS_PORT}/fhir`);
    console.log('  Demo patient IDs       →  demo-vn-001, demo-kr-001, demo-jp-001, demo-en-001');
  }
  if (!ready) console.log('  (API did not report healthy within 30 s — check the log above)');
  console.log('  Stop with Ctrl+C');
  console.log('');
});
