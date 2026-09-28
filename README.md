<p align="center">
  <h1 align="center">FHIRBridge</h1>
  <p align="center">
    <strong>Open-source patient data portability for hospitals and clinics</strong><br/>
    Self-host. Pull from your HIS. Export FHIR R4. Generate AI summaries. Zero PHI persisted.
  </p>
  <p align="center">
    <b>English</b> &bull;
    <a href="README.vi.md">Tiếng Việt</a> &bull;
    <a href="README.ko.md">한국어</a> &bull;
    <a href="README.ja.md">日本語</a>
  </p>
  <p align="center">
    <a href="#quickstart">Quickstart</a> &bull;
    <a href="#features">Features</a> &bull;
    <a href="#regional-support-vn--kr--jp--international">Regional support</a> &bull;
    <a href="#api-endpoints">API</a> &bull;
    <a href="#cli-usage">CLI</a> &bull;
    <a href="#self-host-deployment">Self-host</a> &bull;
    <a href="#privacy--security">Security</a>
  </p>
</p>

---

## What it is

Patient medical records are locked inside hospital information systems (HIS). In Vietnam, 34M+ VneID records lack portability. In Japan, data is siloed per facility with limited interoperability. **FHIRBridge** is the bridge: connect to any HIS via FHIR API or CSV/Excel, transform into standardized FHIR R4 bundles, and (optionally) generate de-identified AI summaries — all running on your own infrastructure.

**No SaaS. No hosted tier. No billing. No quotas.** You pull the repo, you run it. The hospital, clinic, or research group is the operator and the data controller.

## Quickstart

Pick one. Both give you the web UI at **http://localhost:8080** with a synthetic **Demo HIS**
(fake patients from Vietnam, Korea, Japan and the US), so you can try a full export without a
real hospital system or internet access.

### Option A — Node.js (Linux / macOS / Windows)

Requires Node.js ≥ 22 (24 LTS recommended) and pnpm ≥ 9 (`corepack enable` installs pnpm).

```bash
git clone https://github.com/Digital-Healthcare-OpenSource/FHIRBridge.git
cd FHIRBridge
pnpm install
pnpm run setup     # creates .env (random secrets + an API key) and builds everything
pnpm demo          # API + web UI + Demo HIS → http://localhost:8080
```

> `pnpm run setup`, not `pnpm setup` — the latter is a built-in pnpm command.

### Option B — Docker (no Node.js needed on the host)

```bash
git clone https://github.com/Digital-Healthcare-OpenSource/FHIRBridge.git
cd FHIRBridge
# Create .env with random secrets + an API key (uses a throwaway Node container)
docker run --rm -v "$PWD":/app -w /app node:24-alpine node scripts/setup.mjs --env-only
docker compose --profile demo up --build     # → http://localhost:8080
```

Drop `--profile demo` to run without the Demo HIS.

### First export (both options)

1. Open **http://localhost:8080** → **Settings**, paste your API key — the value of the `API_KEYS=`
   line in `.env` (the setup step never prints it) — and click **Save Settings**. The key stays in
   browser memory only.
2. Pick your language (Tiếng Việt / English / 日本語 / 한국어) from the language switcher.
3. **Export** → **FHIR Endpoint** → server URL
   - `pnpm demo`: `http://localhost:8090/fhir`
   - Docker demo profile: `http://demo-his:8090/fhir`
4. Patient ID: `demo-vn-001`, `demo-kr-001`, `demo-jp-001` or `demo-en-001` → start the export
   → download the FHIR R4 Bundle (JSON or NDJSON).
5. **Import** → pick your country's example column mapping → **Try with sample data** → **Import**
   → download the FHIR Bundle built from a CSV / Excel export.

Check an installation from the command line at any time with `pnpm smoke` (health → HIS
connection → export → download; Docker demo: `pnpm smoke --his http://demo-his:8090/fhir`).

### Connect your real HIS

SSRF protection blocks private and loopback addresses by default — and your HIS almost
certainly lives on the hospital network. List it explicitly in `.env`, then run `pnpm start`
(or `docker compose up`):

```bash
# hostnames, IPv4 addresses, IPv4 CIDRs or host:port pairs, comma-separated
CONNECTOR_ALLOWED_HOSTS=his.hospital.local,10.20.0.0/16
```

Cloud-metadata addresses (169.254.0.0/16, `metadata.google.internal`, …) stay blocked even if
listed. For CSV / Excel exports from your HIS, see [Column mappings](examples/README.md).

## Features

- **FHIR R4 Export** — Patient, Encounter, Condition, Observation, MedicationRequest, AllergyIntolerance, Procedure, DiagnosticReport, Immunization, CarePlan, CareTeam, Specimen, DocumentReference, Practitioner, Medication
- **HIS Connectors** — FHIR endpoint (SMART on FHIR / OAuth2) + CSV / Excel import with JSON column mappings
- **AI Summaries (optional)** — Claude or OpenAI providers, de-identified before any external call (HMAC-SHA256 + date shifting), summaries in VI / EN / JA / KO
- **Three interfaces** — CLI tool, REST API (Fastify), React web dashboard in VI / EN / JA / KO
- **Privacy-by-design** — Stream-only architecture, no PHI persisted to durable storage, audit log stores hashes only
- **IPS Bundle support** — International Patient Summary `Bundle.type=document` profile
- **Runs anywhere** — one-command setup, Docker Compose, or a single Node.js process; works offline / air-gapped (no third-party fonts, CDNs or telemetry)

## Regional support (VN / KR / JP / international)

|                        | 🇻🇳 Vietnam                                                      | 🇰🇷 Korea                                                                    | 🇯🇵 Japan                                                                    | 🌐 International                                                      |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Web UI language        | Tiếng Việt                                                      | 한국어                                                                      | 日本語                                                                      | English                                                               |
| AI summary language    | `vi`                                                            | `ko`                                                                        | `ja`                                                                        | `en`                                                                  |
| Column-mapping example | [csv-vneid-vn.json](examples/column-mappings/csv-vneid-vn.json) | [csv-korea-hospital.json](examples/column-mappings/csv-korea-hospital.json) | [excel-japan-clinic.json](examples/column-mappings/excel-japan-clinic.json) | [csv-generic-hl7.json](examples/column-mappings/csv-generic-hl7.json) |
| National ID handling   | VneID identifiers stay on your servers                          | RRN (주민등록번호) HMAC-hashed / masked at ingest                           | —                                                                           | —                                                                     |
| Compliance notes       | [PDPD (Decree 13/2023)](#data-residency--vietnam-pdpd)          | [PIPA](#data-residency--korea-pipa), `AUDIT_PROFILE=kr` access log          | [APPI](#data-residency--japan-appi)                                         | [Privacy & security](#privacy--security)                              |

The UI language is detected from the browser (unsupported languages fall back to English) and
can be changed at any time from the language switcher; the choice is remembered per browser.

## Tech stack

TypeScript (strict, ES2022) · Turborepo + pnpm workspaces · Fastify 5 · Vite 7 + React 18 + Tailwind · Commander.js · Vitest + Playwright · PostgreSQL 16 (audit logs only, no PHI) · Redis 7 (rate limit + caching, optional) · Anthropic SDK · OpenAI SDK · i18next (VI / EN / JA / KO)

## Project layout

```
fhirbridge/
├── packages/
│   ├── types/   FHIR R4 types, AI types, connector types
│   ├── core/    FHIR engine, validators, connectors, AI pipeline, security utilities
│   ├── api/     Fastify REST server (JWT / API key, rate limit, audit, helmet, swagger)
│   ├── cli/     Commander.js CLI tool
│   └── web/     Vite + React + Tailwind dashboard (i18n VI/EN/JA/KO)
├── scripts/     setup.mjs (one-command setup), start.mjs (`pnpm start` / `pnpm demo`)
├── examples/    column mappings for VN / KR / JP / generic HIS exports, synthetic Demo HIS
├── docker/      web image (nginx), Postgres 16 + Redis 7 for persistent audit / multi-replica
├── docker-compose.yml   API + web UI (+ Demo HIS with --profile demo)
└── tests/       integration, E2E (CLI + Playwright), security, performance
```

## API walkthrough — first export with curl

With `pnpm demo` (or the Docker demo profile) running:

```bash
API=http://localhost:8080/api/v1
KEY=$(grep '^API_KEYS=' .env | cut -d= -f2 | cut -d, -f1)
HIS=http://localhost:8090/fhir        # Docker demo profile: http://demo-his:8090/fhir

# 1. Probe the HIS
curl -s -X POST $API/connectors/test -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"type\":\"fhir-endpoint\",\"config\":{\"baseUrl\":\"$HIS\"}}"
# → {"connected":true,"serverVersion":"4.0.1",...}

# 2. Start an export
EXPORT_ID=$(curl -s -X POST $API/export -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"patientId\":\"demo-vn-001\",\"connectorConfig\":{\"type\":\"fhir-endpoint\",\"baseUrl\":\"$HIS\"}}" \
  | jq -r .exportId)

# 3. Poll, then download the FHIR R4 Bundle
curl -s $API/export/$EXPORT_ID/status -H "X-API-Key: $KEY"
curl -s "$API/export/$EXPORT_ID/download?format=json" -H "X-API-Key: $KEY" -o bundle.json

# 4. (Optional, needs ANTHROPIC_API_KEY or OPENAI_API_KEY on the server) AI summary in Vietnamese
curl -s -X POST $API/summary/generate -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"exportId\":\"$EXPORT_ID\",\"summaryConfig\":{\"language\":\"vi\",\"provider\":\"claude\"}}"
```

JWT (HS256, signed with `JWT_SECRET`, `sub` + `exp` claims required) works too, via
`Authorization: Bearer <jwt>`. The OpenAPI UI is served at `/api/v1/docs` when `ENABLE_DOCS=true`.

## Development

```bash
pnpm install
pnpm run setup --no-build                    # .env only
pnpm build                                   # build all packages (the API dev server runs from dist/)
pnpm --filter @fhirbridge/api dev            # API → http://localhost:3001
pnpm --filter @fhirbridge/web dev            # Web → http://localhost:5173 (proxies /api to :3001)

pnpm test               # unit tests (no Docker needed)
pnpm typecheck          # TypeScript strict check
pnpm lint               # ESLint
pnpm format:check       # Prettier

# Extended test suites
pnpm test:integration   # Fastify server.inject() integration tests
pnpm test:e2e:cli       # CLI as real subprocess
pnpm test:e2e           # Playwright (needs Docker + dev servers running)
pnpm test:security      # XSS, SSRF, IDOR, JWT bypass
pnpm test:perf          # Latency + memory + CSV scaling
pnpm test:a11y          # axe-core via Playwright
```

## API endpoints

| Method | Endpoint                       | Description                                                                          |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------ |
| `POST` | `/api/v1/export`               | Initiate patient data export                                                         |
| `GET`  | `/api/v1/export/:id/status`    | Check export progress                                                                |
| `GET`  | `/api/v1/export/:id/download`  | Download FHIR R4 Bundle (`?format=json` or `?format=ndjson`)                         |
| `POST` | `/api/v1/connectors/test`      | Test HIS connection                                                                  |
| `POST` | `/api/v1/connectors/import`    | Upload CSV / Excel file + column mapping                                             |
| `POST` | `/api/v1/summary/generate`     | Generate AI summary from `exportId` or an inline `bundle` (needs an AI provider key) |
| `GET`  | `/api/v1/summary/:id/download` | Download summary (Markdown / JSON)                                                   |
| `POST` | `/api/v1/consent/record`       | Record cross-border AI consent                                                       |
| `POST` | `/api/v1/auth/logout`          | Revoke the caller's JWT (`jti`) and audit the sign-out                               |
| `GET`  | `/api/v1/health`               | Liveness + dependency health                                                         |

**Authentication:** `X-API-Key: <key>` (keys from `API_KEYS`) or `Authorization: Bearer <jwt>`. `/api/v1/health` is public.

## CLI usage

From the repo root (after `pnpm run setup`), prefix commands with `pnpm fhirbridge`:

```bash
# Export from a FHIR endpoint (private / localhost addresses must be allowlisted)
CONNECTOR_ALLOWED_HOSTS=localhost:8090 \
  pnpm fhirbridge export --patient-id demo-vn-001 --endpoint http://localhost:8090/fhir --output bundle.json

# Import CSV / Excel into a FHIR Bundle using a column mapping
pnpm fhirbridge import --file examples/data/vn-hospital.csv --mapping examples/column-mappings/csv-vneid-vn.json --output bundle.json

# Validate a FHIR Bundle
pnpm fhirbridge validate --input bundle.json

# AI summary (de-identified before the API call; needs ANTHROPIC_API_KEY or OPENAI_API_KEY)
export ANTHROPIC_API_KEY=...
pnpm fhirbridge summarize --input bundle.json --provider claude --language vi

# Saved connection profiles
pnpm fhirbridge config add-profile my-hospital
pnpm fhirbridge config list
```

Run `pnpm fhirbridge <command> --help` for every option. The CLI reads settings from its
environment (not from `.env`): export `CONNECTOR_ALLOWED_HOSTS` / provider keys in your shell.

## Self-host deployment

| Setup                         | Command                                   | Audit log        | Rate limit / caches    |
| ----------------------------- | ----------------------------------------- | ---------------- | ---------------------- |
| Single machine, Node.js       | `pnpm start`                              | stdout           | in-memory (1 instance) |
| Single machine, Docker        | `docker compose up -d --build`            | container stdout | in-memory (1 instance) |
| Persistent audit + multi-node | API with `DATABASE_URL` + `REDIS_URL` set | PostgreSQL       | Redis (shared)         |

For PostgreSQL + Redis, start `docker/docker-compose.yml` (passwords come from `.env`), uncomment
`DATABASE_URL` / `REDIS_URL` in `.env` (the setup script already filled in matching passwords),
and apply migrations:

```bash
set -a; . ./.env; set +a                       # export POSTGRES_PASSWORD / REDIS_PASSWORD
docker compose -f docker/docker-compose.yml up -d
pnpm --filter @fhirbridge/api migrate
pnpm start
```

Behavior under degraded infra:

- No `DATABASE_URL` set → audit log writes to stdout (Console sink). Use `journalctl` / log aggregator.
- No `REDIS_URL` set → rate limit + caches stay in-memory per process. Single-replica only.
- No `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` → summary generation answers `503` with the variable to set; export + connector endpoints unaffected.

CI publishes both images to GHCR on every push to `main` (`latest`) and for each release tag
(`<version>`), multi-arch (amd64 + arm64), Trivy-scanned, cosign-signed with SBOM + provenance:
`ghcr.io/digital-healthcare-opensource/fhirbridge-api` and `…/fhirbridge-web`. The root
`docker-compose.yml` already uses these names, so you can skip the build:

```bash
docker compose pull && docker compose up -d            # latest main
FHIRBRIDGE_VERSION=<version> docker compose pull       # or pin a release ≥ 0.3.0 (then `up -d` with the same variable)
```

If `pull` answers `unauthorized`, the packages are not public for your account — build from
source with `docker compose up -d --build` instead.

### Production hardening

FHIRBridge handles PHI in transit. **TLS is REQUIRED in production** — never expose
`:3001` directly. Terminate TLS at a reverse proxy and run the API on loopback / a
private network behind it. The operator is the data controller; these docs cover the
operational contract:

- **[Reverse proxy & TLS](docs/operations/reverse-proxy.md)** — Caddy (automatic HTTPS)
  and nginx examples, `TRUST_PROXY`, and the streaming-critical settings (disable
  response buffering, long read timeouts) needed for NDJSON exports.
- **[Backup & restore](docs/operations/backup-restore.md)** — nightly `pg_dump` of the
  audit DB, retention per jurisdiction (US ~6 yr, VN/JP per local rule), the
  append-only purge path, and a restore drill.
- **[Upgrading](docs/operations/upgrading.md)** — `init.sql` runs on first boot only;
  apply schema changes to an existing database with the built-in runner:
  `pnpm --filter @fhirbridge/api migrate` (DDL-capable `DATABASE_URL`, idempotent,
  checksum drift detection, advisory-locked for multi-replica).
- **[Scaling](docs/operations/scaling.md)** — single-replica by default; running
  multiple replicas **requires `REDIS_URL`** (exports, summaries, idempotency, and
  rate limiting are otherwise per-process), plus per-replica `/metrics` scraping.

Pin production deployments to an image **digest** (not `:latest`), and verify the
cosign signature / SBOM / provenance attestations published with each release.

## Privacy & security

| Protection           | Implementation                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Zero PHI at rest     | Stream-only export pipeline; in-memory record TTL 10 min                                                                                |
| De-identification    | HMAC-SHA256 + per-patient deterministic date shift before AI call                                                                       |
| Safe Harbor age cap  | `birthDate` removed when computed age ≥ 89 (HIPAA §164.514(b)(2)(i)(C))                                                                 |
| SSRF protection      | Blocks private IPs, link-local, IPv6 loopback, cloud metadata; internal HIS hosts opt-in via `CONNECTOR_ALLOWED_HOSTS` (metadata never) |
| IDOR protection      | Ownership verified on every export / summary access; cross-tenant attempts audited as 404                                               |
| Authentication       | JWT (HS256) + API key with `crypto.timingSafeEqual` comparison                                                                          |
| Rate limiting        | Per-user / per-IP, 100 req/min default (configurable via `RATE_LIMIT_PER_MINUTE`)                                                       |
| Audit logging        | HMAC-SHA256 hashes of user IDs, action types, resource counts only — never raw identifiers                                              |
| Cross-border consent | Per-session consent recording before sending data to non-domestic AI providers                                                          |
| BAA disclaimer       | Hospital operator owns the BAA decision; UI surfaces the disclaimer for end users                                                       |
| HMAC secret reuse    | Boot fails if `HMAC_SECRET == JWT_SECRET` (Zod-enforced)                                                                                |

### AI summaries without leaving your network

The `openai` provider talks to any server that implements the OpenAI Chat Completions API
(`POST <base>/chat/completions`), so the summary model can run in-country or inside the
hospital network instead of at a foreign provider:

```bash
AI_PROVIDER=openai
OPENAI_BASE_URL=http://10.20.0.5:8000/v1   # your server's OpenAI-compatible base URL
OPENAI_MODEL=<model-name-your-server-serves>
OPENAI_API_KEY=<the key your server expects; any non-empty value if it checks none>
```

`ANTHROPIC_BASE_URL` does the same for Claude requests (for example an API gateway that
speaks the Anthropic Messages API). The data is still de-identified before it is sent, and
`fhirbridge summarize` names the configured host in its data-transfer warning. FHIRBridge
cannot tell where a server physically runs — whether a setup counts as a cross-border
transfer is for your DPO to decide (see the country notes below).

### Data residency — Japan (APPI)

Under Japan's APPI, pseudonymized patient data (HMAC-hashed IDs, shifted dates) is
still **personal information**, and sending 要配慮個人情報 (special care-required
personal information) to an AI provider hosted outside Japan generally requires
explicit per-patient consent naming the destination country (Art. 28).

**Recommendation for Japanese deployments:** run with AI summaries disabled (simply
omit `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — export and connectors are unaffected),
or keep inference in-country — through your provider contract or a model you host yourself
([AI summaries without leaving your network](#ai-summaries-without-leaving-your-network)).
The built-in consent recording captures operator consent, not patient consent — the
operator remains the data controller. This is engineering guidance, not legal advice.

### Data residency — Korea (PIPA)

Under Korea's PIPA, transferring personal information overseas requires consent that
discloses **five items** (Art. 28-8): the data being transferred, the destination
country and transfer method, the recipient's name and contact, the recipient's
purpose of use and retention period, and how to refuse plus the consequences of
refusal. FHIRBridge's consent modal presents all five items, and the consent API
rejects a Korean-market grant that does not acknowledge all five. The resident
registration number (주민등록번호) is additionally protected: RRN values detected at
ingest are HMAC-hashed or masked and never flow through the pipeline raw (Art. 24-2).

**Access log (접속기록):** set `AUDIT_PROFILE=kr` to enrich every audit row with
`patientRefHash` (HMAC of the accessed patient id — never raw) and `sourceIp`,
per the KR 안전성 확보조치 access-log requirement (who / when / whose record /
from where). Keep audit rows **≥ 2 years**: set `AUDIT_RETENTION_DAYS=730` (or
more) and the API runs a daily `purge_audit_logs()` purge in-process (apply
migration 002 via `pnpm --filter @fhirbridge/api migrate` so the least-privilege
role may execute it). Leave it unset to manage retention yourself — the table is
append-only outside that function; e.g. schedule
`SELECT purge_audit_logs(INTERVAL '2 years');` via pg_cron. Review the log
periodically. Note: `sourceIp` is personal data under GDPR —
the field only exists under the KR profile; leave `AUDIT_PROFILE` unset elsewhere.

**Recommendation for Korean deployments:** as with Japan, prefer running with AI
summaries disabled or with an in-country/self-hosted provider
([how](#ai-summaries-without-leaving-your-network)). The built-in consent
recording captures operator consent, not patient consent — your DPO decides the
patient-consent process. This is engineering guidance, not legal advice.

### Data residency — Vietnam (PDPD)

Under Vietnam's Personal Data Protection Decree (Nghị định 13/2023/NĐ-CP), health
status and medical-record information is **sensitive personal data** (dữ liệu cá
nhân nhạy cảm, Art. 2). Processing it requires explicit, affirmative consent
(Art. 11 — silence is not consent), and the patient must be told the data being
processed is sensitive. The decree has no GDPR-style pseudonymization carve-out,
so treat HMAC-hashed IDs and shifted dates as still-personal data: sending them to
an AI provider hosted outside Vietnam is a **cross-border transfer**, and the
operator must prepare a transfer impact assessment dossier (hồ sơ đánh giá tác
động chuyển dữ liệu cá nhân ra nước ngoài, Art. 25) — alongside the general
processing impact assessment (Art. 24) — and file it with the Ministry of Public
Security (A05) within 60 days of the transfer commencing. Since 2026-01-01 the
Personal Data Protection Law (Luật Bảo vệ dữ liệu cá nhân) sits above the decree;
confirm the current filing mechanics with counsel.

**Data localization (Nghị định 53/2022/NĐ-CP):** the Cybersecurity Law's
data-localization rules are satisfied by design in a self-hosted deployment — the
pipeline runs entirely on your own infrastructure, exports stream from the HIS to
the client with zero PHI at rest, and VneID identifiers in CSV imports
([examples/column-mappings/csv-vneid-vn.json](examples/column-mappings/csv-vneid-vn.json))
never leave your servers. The only payload that can cross the border is the
optional AI summary, and it is de-identified first (identifiers HMAC-hashed,
names redacted to `[PATIENT]`/`[PROVIDER]`, dates deterministically shifted). If
your organization falls under Decree 53's log-retention duties, set
`AUDIT_RETENTION_DAYS` at or above the applicable floor (the API then purges
daily via `purge_audit_logs()`; unset = no automatic deletion, the table is
append-only otherwise) — audit rows contain HMAC hashes and counts only, never
raw identifiers or RRN/VneID values.

**Recommendation for Vietnamese deployments:** as with Japan and Korea, prefer
running with AI summaries disabled (omit `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` —
export and connectors are unaffected) or an in-country/self-hosted provider. If
you enable a foreign provider, the consent modal (Vietnamese-first UI) discloses
the destination, provider and contact, purpose, data categories, and retention
before every summary call — but it records operator consent, not patient consent,
and consent does not replace the Art. 25 dossier: your DPO owns the
patient-consent process and the MPS filing. This is engineering guidance, not
legal advice.

## Testing

```bash
pnpm test               # unit tests: types, core, api, cli, web
pnpm test:integration   # API integration (Fastify inject)
pnpm test:e2e:cli       # CLI as a real subprocess
pnpm test:security      # XSS, SSRF, IDOR, JWT, upload, RRN masking
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs build, typecheck, lint, a
production dependency audit, unit, integration, CLI E2E and security tests, plus CodeQL and a
gitleaks secret scan, on every push and pull request to `main`. The Playwright suites
(`pnpm test:e2e`, `pnpm test:a11y`) run locally.

## Environment variables

`pnpm run setup` writes a working `.env`; see [`.env.example`](.env.example) for every option.

| Variable                  | Required | Description                                                                               |
| ------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `JWT_SECRET`              | Yes      | JWT signing key (>= 32 chars, no placeholder text)                                        |
| `HMAC_SECRET`             | Yes      | De-identification HMAC key (>= 32 chars, must differ from `JWT_SECRET`)                   |
| `API_KEYS`                | No       | Comma-separated static API keys (web UI Settings / `X-API-Key` header)                    |
| `PORT` / `HOST`           | No       | API listen address (default `3001` / `127.0.0.1`; Docker uses `0.0.0.0` in the container) |
| `WEB_PORT` / `WEB_HOST`   | No       | Web UI address for `pnpm start` and Docker (default `8080` / `127.0.0.1`)                 |
| `CONNECTOR_ALLOWED_HOSTS` | No       | Internal HIS hosts to allow through SSRF protection (hostnames, IPv4, CIDRs, `host:port`) |
| `CORS_ORIGINS`            | No       | Comma-separated allow-list (only needed when the UI is served from another origin)        |
| `DATABASE_URL`            | No       | PostgreSQL connection for persistent audit logs                                           |
| `REDIS_URL`               | No       | Redis connection for distributed rate limit + caches                                      |
| `AUDIT_PROFILE`           | No       | `kr` = Korean access-log fields (`patientRefHash`, `sourceIp`)                            |
| `AUDIT_RETENTION_DAYS`    | No       | Opt-in daily purge of audit rows older than N days (KR needs >= 730)                      |
| `AI_PROVIDER`             | No       | Default summary provider when a request does not name one: `anthropic` or `openai`        |
| `ANTHROPIC_API_KEY`       | For AI   | Claude API key                                                                            |
| `ANTHROPIC_MODEL`         | No       | Claude model (default `claude-opus-5`)                                                    |
| `OPENAI_API_KEY`          | For AI   | OpenAI API key                                                                            |
| `OPENAI_MODEL`            | No       | OpenAI model (default `gpt-4o`)                                                           |
| `ANTHROPIC_BASE_URL`      | No       | Endpoint for Claude requests, e.g. an API gateway (default `https://api.anthropic.com`)   |
| `OPENAI_BASE_URL`         | No       | Endpoint for `openai` requests — any OpenAI Chat Completions–compatible server            |
| `RATE_LIMIT_PER_MINUTE`   | No       | Override the default 100 req/min budget                                                   |
| `METRICS_BEARER_TOKEN`    | No       | Bearer token (>= 16 chars) for `/metrics`; off when unset                                 |
| `TRUST_PROXY`             | No       | `true`, a CIDR or `loopback` when running behind a reverse proxy                          |
| `ENABLE_DOCS`             | No       | `true` exposes the OpenAPI UI at `/api/v1/docs`                                           |

Empty values (`KEY=`) are treated as unset.

## Contributing

Contributions are welcome — translations (VI / KO / JA review by native speakers is especially
valuable), HIS column mappings, connectors and bug reports. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report
security issues privately as described in [SECURITY.md](.github/SECURITY.md).

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm lint
```

## License

[MIT](LICENSE)
