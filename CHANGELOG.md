# Changelog

All notable changes to FHIRBridge are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- **SSRF protection now also holds at connect time (DNS rebinding).** FHIR endpoint and OAuth2
  token requests go through a small built-in HTTP client whose DNS lookup re-applies the SSRF
  policy to the exact addresses the socket connects to, so a DNS answer that changes after the
  pre-flight check can no longer reach private, loopback or cloud-metadata addresses. Redirects
  are followed only for GET (max 5, each re-validated) and never forward the bearer token to
  another origin; the token endpoint is never redirected; responses are capped at 64 MiB after
  decompression. This replaces `fhir-kit-client`.
- Dependency advisories: `fastify` 5.12.5
  ([GHSA-w2qp-rph6-63g4](https://github.com/advisories/GHSA-w2qp-rph6-63g4),
  [GHSA-3m5p-2c4r-xxw2](https://github.com/advisories/GHSA-3m5p-2c4r-xxw2)), `csv-parse` 7.0.3
  ([GHSA-8cw4-87c7-c6xx](https://github.com/advisories/GHSA-8cw4-87c7-c6xx)); dropping
  `fhir-kit-client` also removes `decode-uri-component` 0.2.2
  ([GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)).
  `pnpm audit --prod` reports no known vulnerabilities.
- **Node.js 24 LTS.** Node 20 reached end-of-life on 2026-04-30
  ([schedule](https://github.com/nodejs/release#release-schedule)). Docker images and CI use
  Node 24; the minimum supported version is Node 22 (checked by a CI job).

### Added

- **Web UI image on GHCR.** CI now publishes `fhirbridge-web` next to `fhirbridge-api` (same
  Trivy gate, multi-arch, cosign signature, SBOM + provenance). The root `docker-compose.yml`
  uses the GHCR names (`FHIRBRIDGE_VERSION`, `FHIRBRIDGE_REGISTRY` to pin or mirror), so
  `docker compose pull && docker compose up` runs without building; `--build` still builds
  from source.
- **One-command setup and run.** `pnpm run setup` creates `.env` with random secrets, an API key
  and database / cache passwords (idempotent, cross-platform, `--env-only` for Docker), then
  builds everything. `pnpm start` serves the web UI and API together on
  `http://localhost:8080` (static files + streaming `/api` proxy, security headers).
- **Demo HIS.** `pnpm demo` / `docker compose --profile demo up` start a synthetic FHIR R4 server
  with fictional patients from Vietnam, Korea, Japan and the US, so the full export flow can be
  tried without a hospital system or internet access.
- **Full-stack Docker Compose** at the repo root: API + nginx web UI (+ optional Demo HIS),
  read-only containers, UI bound to `127.0.0.1`. New web image in `docker/web/`.
- **`CONNECTOR_ALLOWED_HOSTS`** — explicit allowlist (hostnames, IPv4, CIDRs, `host:port`) for
  HIS servers on the hospital network, which SSRF protection previously made impossible to
  reach. Cloud-metadata and link-local targets stay blocked even when listed (incl. IPv6 forms).
- `pnpm smoke` — end-to-end installation check (health → HIS → export → download); also run in
  CI against Docker Compose.
- Summaries from an export id: `POST /api/v1/summary/generate` accepts `exportId` (ownership
  checked) so the web UI no longer needs the bundle.
- `ANTHROPIC_MODEL` / `OPENAI_MODEL` to pin provider models; `AI_PROVIDER` now selects the
  default provider. Provider keys and models are read once through the validated API config.
- **Web UI fully localized in Tiếng Việt / English / 日本語 / 한국어** — every page, the landing
  page (new `landing` namespace), status labels, dates and numbers follow the selected language;
  a language switcher in the header and landing navbar; `<html lang>` follows the language;
  browsers with unsupported languages fall back to English. A unit test enforces key and
  placeholder parity across all four locales.
- Dashboard "Recent exports" lists the exports started in the current tab (memory only).
- **Import page with ready-made mappings**: pick the Vietnam / Korea / Japan / international
  example mapping (or upload your own JSON), try it with bundled synthetic sample data, see
  row-level warnings, and download the resulting FHIR Bundle.
- `examples/column-mappings/mapping.schema.json` (JSON Schema for editors) and synthetic sample
  files in `examples/data/` that match every example mapping.
- `README.vi.md`, `README.ko.md`, `README.ja.md` quickstarts; `CODE_OF_CONDUCT.md`; issue forms
  (bug, feature, translation feedback) and a pull-request template; CI job that builds the
  Docker Compose stack and runs the smoke test.

### Changed

- Default Claude model is now `claude-opus-5` (the previous default,
  `claude-sonnet-4-20250514`, is deprecated by Anthropic). `temperature` is no longer sent to
  Claude (current models reject sampling parameters). Summary calls allow 16k output tokens and
  a 120 s timeout.
- `.env.example`: Postgres / Redis URLs are commented out by default (the documented
  "no infrastructure" dev mode), `HOST` defaults to `127.0.0.1`.
- Configuration errors name the environment variable (e.g. `METRICS_BEARER_TOKEN
(metricsBearerToken)`) and point to `pnpm run setup`; a missing `HMAC_SECRET` is reported as
  missing instead of silently falling back to `JWT_SECRET`.
- Repository links point to `Digital-Healthcare-OpenSource/FHIRBridge`.
- The import API requires a column mapping (part `mapping`, text or file) and returns
  `resourcesByType`, `rowsRead` and `warnings` alongside the bundle. Example identifier systems
  that could not be verified (a `vneid.gov.vn` URL, a Japanese OID) were replaced by clearly
  marked placeholders; WHO ICD-10 (`http://hl7.org/fhir/sid/icd-10`) is now a known code system.
- Web UI no longer loads Google Fonts (privacy, offline hospital networks, no CJK glyphs); it
  uses a system font stack covering Latin, Vietnamese, Korean and Japanese.
- Settings page: the credential field is clearly the FHIRBridge API key / token; the unused
  AI-provider and summary-language selectors (which offered unsupported values) were removed in
  favour of the interface-language selector.
- Summary viewer offers only values the API accepts (`claude` / `openai`, `en` / `vi` / `ja` /
  `ko`), defaults to the UI language, and downloads Markdown (the former "PDF" button already
  downloaded Markdown).
- The export wizard's "File upload" option now leads to the Import page — the export API only
  exports from FHIR endpoints.
- Landing page copy corrected to match the code: no "HL7 Certified" badge, 15 (not 8) resource
  types, HMAC is described as pseudonymization (bundles are not signed), no quota or refresh-token
  claims, no unsourced market statistics, Korea included, placeholder footer links replaced.

### Fixed

- **CSV / Excel import produced empty bundles on every path** (CLI, API, web): mappings were
  never applied, the documented example format was not understood, and the API added raw rows
  as invalid resources. Import now uses one canonical mapping format (the documented `fields`
  format; the older formats are still accepted), builds valid, referenced FHIR resources
  (Patient, Encounter, Condition, Observation, Procedure, AllergyIntolerance) and validates them.
  Korean RRNs are HMAC-hashed with `HMAC_SECRET` (masked otherwise) and never appear raw.
  The API reports mapping errors (`400`), content that yields nothing (`422`) and oversize
  input (`413`) clearly; the CLI exits non-zero instead of writing an empty bundle.
- Excel date cells were read as serial numbers.
- CSV imports now stop at a 1,000,000-row ceiling (`413`), like Excel imports, instead of
  transforming arbitrarily many rows.
- Import uploads are written to a private `mkdtemp` directory (0700) with an exclusively
  created 0600 file, and the directory is deleted before the response is sent (previously the
  temp file was removed only after the client already had its answer).
- `fast-uri` raised to 3.1.6 / 4.1.3 (pnpm overrides) for new high-severity advisories.
- `fhirbridge export` / `summarize` without `--output` mixed status lines into the data on
  stdout; status now goes to stderr so the output can be redirected to a file.

- The API ignored the documented root `.env` when started with
  `pnpm --filter @fhirbridge/api dev|start|migrate` and refused to boot.
- Empty values copied from `.env.example` (e.g. `METRICS_BEARER_TOKEN=`) failed validation and
  blocked startup; empty values are now treated as unset.
- AI summaries from the web UI always failed with `400` (language names instead of codes,
  unsupported provider names, no bundle sent), and failed jobs looked like "still processing"
  forever. Failed jobs now return `502` with the reason; a missing provider key returns `503`
  naming the variable to set.
- Summary routes ignored the Redis / audit-wired `SummaryService` built at startup.
- `fhirbridge summarize` imported a package that does not exist and always printed a placeholder;
  it now runs the real de-identify → summarize pipeline and fails clearly without an API key.
  The CLI no longer offers the unsupported `gemini` provider.
- The `fhirbridge` bin pointed at a module that never ran the CLI.
- Summary errors from the server (e.g. "Summary generation failed: …") were replaced by a generic
  `HTTP 502` message in the web UI.
- Dark mode toggle had no effect and Markdown summaries were unstyled (Tailwind v4 ignored
  `tailwind.config.ts`).
- A finished export showed "Invalid date", a spinning last step and an "Exporting…" heading.
- The export wizard showed a blank page when starting an export failed (e.g. not signed in).

## [0.2.0] - 2026-07-24

Four-market readiness release (EN / VI / JA / KO): Korean locale and PIPA features (RRN
protection, Art. 28-8 cross-border consent, `AUDIT_PROFILE=kr` access log), Vietnam PDPD
documentation, schema-migration runner, revived security and Playwright suites, accessibility
and dependency hardening. See the
[release notes](https://github.com/Digital-Healthcare-OpenSource/FHIRBridge/releases/tag/v0.2.0).

[Unreleased]: https://github.com/Digital-Healthcare-OpenSource/FHIRBridge/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Digital-Healthcare-OpenSource/FHIRBridge/releases/tag/v0.2.0
