<p align="center">
  <h1 align="center">FHIRBridge</h1>
  <p align="center">
    <strong>Open-source patient data portability for hospitals and clinics</strong><br/>
    Self-host. Pull from your HIS. Export FHIR R4. Generate AI summaries. Zero PHI persisted.
  </p>
  <p align="center">
    <a href="#features">Features</a> &bull;
    <a href="#quickstart">Quickstart</a> &bull;
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

## Features

- **FHIR R4 Export** — Patient, Encounter, Condition, Observation, MedicationRequest, AllergyIntolerance, Procedure, DiagnosticReport, Immunization, CarePlan, CareTeam, Specimen, DocumentReference, Practitioner, Medication
- **HIS Connectors** — FHIR endpoint (SMART on FHIR / OAuth2) + CSV / Excel import with visual column mapping
- **AI Summaries (optional)** — Claude or OpenAI providers, de-identified before any external call (HMAC-SHA256 + date shifting), supports VI / EN / JA / KO
- **Three interfaces** — CLI tool, REST API (Fastify), React web dashboard
- **Privacy-by-design** — Stream-only architecture, no PHI persisted to durable storage, audit log stores hashes only
- **IPS Bundle support** — International Patient Summary `Bundle.type=document` profile

## Tech stack

TypeScript (strict, ES2022) · Turborepo + pnpm workspaces · Fastify 5 · Vite 6 + React 18 + Tailwind · Commander.js · Vitest + Playwright · PostgreSQL 16 (audit logs only, no PHI) · Redis 7 (rate limit + caching, optional) · Anthropic SDK · OpenAI SDK · i18next (VI / EN / JA / KO)

## Project layout

```
fhirbridge/
├── packages/
│   ├── types/   FHIR R4 types, AI types, connector types
│   ├── core/    FHIR engine, validators, connectors, AI pipeline, security utilities
│   ├── api/     Fastify REST server (JWT, rate limit, audit, helmet, swagger)
│   ├── cli/     Commander.js CLI tool
│   └── web/     Vite + React + Tailwind dashboard (i18n VI/EN/JA/KO)
├── docker/      Postgres 16 + Redis 7 (optional, only needed for audit log + multi-replica rate limit)
└── tests/       1100+ tests across unit, integration, E2E, security, performance
```

## Prerequisites

- Node.js >= 20 LTS
- pnpm >= 9
- (Optional) Docker + Docker Compose — only needed if you want persistent audit logs (Postgres) or distributed rate limiting (Redis). The server runs fine with both off, falling back to Console-audit + in-memory rate limit.

## Quickstart — 2-minute Docker

The fastest way to try FHIRBridge is the pre-built image. The API runs with no Postgres / Redis — audit goes to stdout, rate limit is in-memory.

```bash
# Generate two secrets (each ≥ 32 chars, must differ)
JWT_SECRET=$(openssl rand -hex 48)
HMAC_SECRET=$(openssl rand -hex 48)

# Pull and run — pin to a released version tag (not :latest) so a deploy is
# reproducible. For production, pin to an immutable digest instead:
#   ghcr.io/tranhoangtu-it/fhirbridge-api@sha256:<digest>
# Images are cosign-signed and ship SBOM + provenance attestations; verify with
#   cosign verify ghcr.io/tranhoangtu-it/fhirbridge-api:v0.1.0 \
#     --certificate-identity-regexp '.*' --certificate-oidc-issuer-regexp '.*'
docker run --rm \
  -e JWT_SECRET=$JWT_SECRET \
  -e HMAC_SECRET=$HMAC_SECRET \
  -p 3001:3001 \
  ghcr.io/tranhoangtu-it/fhirbridge-api:v0.1.0

# In another terminal:
curl http://localhost:3001/api/v1/health
# → {"status":"ok","version":"0.1.0",...,"checks":{"server":"ok","database":"disabled","redis":"disabled"}}
```

To run the web dashboard alongside, build it once and serve `packages/web/dist/` from any static host (nginx / Caddy / S3+CloudFront / Cloudflare Pages). It points at `VITE_API_BASE_URL`.

For full Postgres + Redis posture, see [Self-host deployment](#self-host-deployment).

## 5-minute walkthrough — first export

This walkthrough hits the public HAPI FHIR sandbox so you can verify everything end-to-end without an HIS handy.

```bash
# 1. Issue a JWT for yourself (uses the same JWT_SECRET as the server)
JWT=$(node -e "const j=require('jsonwebtoken');console.log(j.sign({sub:'demo'},process.env.JWT_SECRET))")

# 2. Probe the public HAPI FHIR endpoint
curl -X POST http://localhost:3001/api/v1/connectors/test \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"type":"fhir-endpoint","baseUrl":"https://hapi.fhir.org/baseR4"}'

# 3. Kick off an export of patient #1
EXPORT_ID=$(curl -s -X POST http://localhost:3001/api/v1/export \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"patientId":"1","connectorConfig":{"type":"fhir-endpoint","baseUrl":"https://hapi.fhir.org/baseR4"}}' \
  | jq -r .exportId)
echo "Export id: $EXPORT_ID"

# 4. Poll until complete
curl -s http://localhost:3001/api/v1/export/$EXPORT_ID/status -H "Authorization: Bearer $JWT" | jq

# 5. Download as NDJSON
curl -s "http://localhost:3001/api/v1/export/$EXPORT_ID/download?format=ndjson" \
  -H "Authorization: Bearer $JWT" \
  -o patient-bundle.ndjson
wc -l patient-bundle.ndjson
```

For CSV / Excel imports, drop in one of the [examples/column-mappings/](examples/column-mappings/) files — they cover Vietnamese, Japanese, and generic HL7-flavored exports.

## Build from source

```bash
# 1. Clone and install
git clone https://github.com/tranhoangtu-it/FHIRBridge.git
cd FHIRBridge
pnpm install

# 2. Configure environment (only the security secrets are required)
cp .env.example .env
#   Required:  JWT_SECRET, HMAC_SECRET (each >= 32 chars, must be different)
#   Optional:  DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY, OPENAI_API_KEY

# 3. Build + run the unit tests
pnpm build
pnpm test                                    # ~1100 tests, no Docker required

# 4. Start dev servers (no infra dependencies — uses Console audit + in-memory store)
pnpm --filter @fhirbridge/api dev            # API   → http://localhost:3001
pnpm --filter @fhirbridge/web dev            # Web   → http://localhost:5173
```

That's it for development. Optional infra (Postgres + Redis) below in [Self-host deployment](#self-host-deployment).

## Development commands

```bash
pnpm build              # Build all packages
pnpm dev                # Start all dev servers via turbo
pnpm test               # All unit tests (~1100, no Docker)
pnpm typecheck          # TypeScript strict check
pnpm lint               # ESLint + Prettier

# Extended test suites
pnpm test:integration   # Fastify server.inject() integration tests
pnpm test:e2e:cli       # CLI as real subprocess
pnpm test:e2e           # Playwright (needs Docker + dev servers running)
pnpm test:security      # XSS, SSRF, IDOR, JWT bypass
pnpm test:perf          # Latency + memory + CSV scaling
pnpm test:a11y          # axe-core via Playwright
```

## API endpoints

| Method | Endpoint                       | Description                                                                    |
| ------ | ------------------------------ | ------------------------------------------------------------------------------ |
| `POST` | `/api/v1/export`               | Initiate patient data export                                                   |
| `GET`  | `/api/v1/export/:id/status`    | Check export progress                                                          |
| `GET`  | `/api/v1/export/:id/download`  | Download FHIR R4 Bundle (`?format=json` or `?format=ndjson`)                   |
| `POST` | `/api/v1/connectors/test`      | Test HIS connection                                                            |
| `POST` | `/api/v1/connectors/import`    | Upload CSV / Excel file                                                        |
| `POST` | `/api/v1/summary/generate`     | Generate AI patient summary (requires `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) |
| `GET`  | `/api/v1/summary/:id/download` | Download summary (Markdown / FHIR Composition)                                 |
| `POST` | `/api/v1/consent/record`       | Record cross-border AI consent                                                 |
| `GET`  | `/api/v1/health`               | Liveness + dependency health                                                   |

OpenAPI spec served at `/api/v1/docs` (only outside production, or set `ENABLE_DOCS=true`).

**Authentication:** `Authorization: Bearer <jwt>` or `X-API-Key: <key>`. `/api/v1/health` is public.

## CLI usage

```bash
# Export from a FHIR endpoint
fhirbridge export --patient-id 123 --endpoint https://hapi.fhir.org/baseR4

# Import CSV / Excel into a FHIR Bundle
fhirbridge import --file patients.csv --mapping mapping.json --output bundle.json

# Generate an AI summary (de-identified before the API call)
fhirbridge summarize --input bundle.json --provider claude --language vi

# Validate a FHIR Bundle
fhirbridge validate --input bundle.json

# Manage saved connection profiles
fhirbridge config add-profile my-hospital
fhirbridge config list
```

## Self-host deployment

The simplest deployment is a single Node.js process. Docker compose for Postgres + Redis is provided but optional.

```bash
# 1. Build the production bundle
pnpm build

# 2. (Optional) Start Postgres + Redis for persistent audit logs and distributed rate limit.
#    POSTGRES_PASSWORD and REDIS_PASSWORD are REQUIRED (compose fails fast if unset)
#    and both services bind to 127.0.0.1 only. Redis persistence is disabled and
#    /data is tmpfs, so no cached record is ever written to durable disk.
export POSTGRES_PASSWORD=$(openssl rand -hex 24)
export REDIS_PASSWORD=$(openssl rand -hex 24)
docker compose -f docker/docker-compose.yml up -d

# 3. Start the API server
NODE_ENV=production pnpm --filter @fhirbridge/api start

# 4. Serve the web bundle (any static host works — nginx, Caddy, etc.)
pnpm --filter @fhirbridge/web build
# upload packages/web/dist to your static host
```

Behavior under degraded infra:

- No `DATABASE_URL` set → audit log writes to stdout (Console sink). Use `journalctl` / log aggregator.
- No `REDIS_URL` set → rate limit + caches stay in-memory per process. Single-replica only.
- No `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` → AI summary endpoints return a clear error; export + connector endpoints unaffected.

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

| Protection           | Implementation                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Zero PHI at rest     | Stream-only export pipeline; in-memory record TTL 10 min                                   |
| De-identification    | HMAC-SHA256 + per-patient deterministic date shift before AI call                          |
| Safe Harbor age cap  | `birthDate` removed when computed age ≥ 89 (HIPAA §164.514(b)(2)(i)(C))                    |
| SSRF protection      | Blocks private IPs, link-local, IPv6 loopback, cloud metadata                              |
| IDOR protection      | Ownership verified on every export / summary access; cross-tenant attempts audited as 404  |
| Authentication       | JWT (HS256) + API key with `crypto.timingSafeEqual` comparison                             |
| Rate limiting        | Per-user / per-IP, 100 req/min default (configurable via `RATE_LIMIT_PER_MINUTE`)          |
| Audit logging        | HMAC-SHA256 hashes of user IDs, action types, resource counts only — never raw identifiers |
| Cross-border consent | Per-session consent recording before sending data to non-domestic AI providers             |
| BAA disclaimer       | Hospital operator owns the BAA decision; UI surfaces the disclaimer for end users          |
| HMAC secret reuse    | Boot fails if `HMAC_SECRET == JWT_SECRET` (Zod-enforced)                                   |

### Data residency — Japan (APPI)

Under Japan's APPI, pseudonymized patient data (HMAC-hashed IDs, shifted dates) is
still **personal information**, and sending 要配慮個人情報 (special care-required
personal information) to an AI provider hosted outside Japan generally requires
explicit per-patient consent naming the destination country (Art. 28).

**Recommendation for Japanese deployments:** run with AI summaries disabled (simply
omit `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — export and connectors are unaffected),
or ensure your provider contract keeps inference in-country before enabling them.
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
from where). Keep audit rows **≥ 2 years**: the table is append-only and deletion
runs only through the scheduled purge function — e.g. a pg_cron/cron job running
`SELECT purge_audit_logs(INTERVAL '2 years');` — so size that interval to the KR
floor and review the log periodically. Note: `sourceIp` is personal data under GDPR —
the field only exists under the KR profile; leave `AUDIT_PROFILE` unset elsewhere.

**Recommendation for Korean deployments:** as with Japan, prefer running with AI
summaries disabled or with an in-country/self-hosted provider. The built-in consent
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
your organization falls under Decree 53's log-retention duties, schedule the
audit purge accordingly (the table is append-only; deletion runs only through
`SELECT purge_audit_logs(INTERVAL '…');` via pg_cron/cron, so pick an interval at
or above the applicable floor) — audit rows contain HMAC hashes and counts only,
never raw identifiers or RRN/VneID values.

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

Roughly 1100 unit + integration tests pass on every commit.

```
core: ~627 tests (validators, connectors, AI pipeline, de-identifier invariants)
api:  ~179 tests (routes, services, plugins, IDOR + auth security)
web:  ~238 tests (components, hooks, i18n, accessibility)
cli:  test commands for every CLI verb
```

## Environment variables

See `.env.example` for full documentation.

| Variable                | Required | Description                                                             |
| ----------------------- | -------- | ----------------------------------------------------------------------- |
| `JWT_SECRET`            | Yes      | JWT signing key (>= 32 chars)                                           |
| `HMAC_SECRET`           | Yes      | De-identification HMAC key (>= 32 chars, must differ from `JWT_SECRET`) |
| `API_KEYS`              | No       | Comma-separated list of static API keys                                 |
| `CORS_ORIGINS`          | No       | Comma-separated allow-list (default `http://localhost:3000`)            |
| `DATABASE_URL`          | No       | PostgreSQL connection for persistent audit logs                         |
| `REDIS_URL`             | No       | Redis connection for distributed rate limit + caches                    |
| `ANTHROPIC_API_KEY`     | For AI   | Claude API key                                                          |
| `OPENAI_API_KEY`        | For AI   | OpenAI API key                                                          |
| `RATE_LIMIT_PER_MINUTE` | No       | Override the default 100 req/min budget                                 |
| `METRICS_BEARER_TOKEN`  | No       | Bearer token for `/metrics`; off when unset                             |
| `TRUST_PROXY`           | No       | `true` or a CIDR string when running behind a load balancer             |
| `ENABLE_DOCS`           | No       | Set to `true` to expose `/api/v1/docs` in production                    |

## Contributing

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm lint
```

## License

MIT
