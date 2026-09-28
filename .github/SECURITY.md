# Security Policy

## Supported versions

FHIRBridge has no formal release cadence yet. Security fixes land on `main` and ship in the next
tagged release ([releases](https://github.com/Digital-Healthcare-OpenSource/FHIRBridge/releases)).
Only the latest release and `main` are supported — there are no LTS branches.

## Reporting a vulnerability

**Please do not open a public GitHub issue with exploit details.**

Use the GitHub private security advisory flow:

→ **https://github.com/Digital-Healthcare-OpenSource/FHIRBridge/security/advisories/new**

The maintainer is automatically notified and can coordinate a fix in private until a coordinated disclosure date is agreed.

### What to include

1. **Affected component** — package name, file path, line number(s) if known.
2. **Commit hash** of `main` you tested against (`git rev-parse HEAD`).
3. **Reproduction** — minimal steps, sample payload, command, or test case.
4. **Impact** — what an attacker can read / modify / cause; severity in your own words.
5. **Suggested fix** if you have one. Optional, but appreciated.

## What's in scope

- The code in `packages/`, `tests/`, `docker/`, `.github/workflows/`.
- The de-identifier invariants in `packages/core/src/ai/deidentifier.ts`.
- Authentication (`packages/api/src/plugins/auth-plugin.ts`).
- SSRF validator (`packages/core/src/security/ssrf-validator.ts`).
- IDOR ownership checks in `ExportService` / `SummaryService`.
- Streaming export back-pressure / abort handling.
- Helmet / security headers configuration.
- Default rate-limit budget.
- Anything in `tests/security/`.

## What's out of scope

- Operator-side misconfiguration (e.g., reusing JWT_SECRET as HMAC_SECRET — Zod blocks this at boot, but if an operator hand-crafts a config that bypasses the schema, that is on them).
- Operator's own reverse proxy / TLS termination.
- Operator's choice of AI provider.
- Operator's BAA / DPA / consent paperwork (legal posture is operator-owned).
- Vulnerabilities in upstream dependencies (those go to the dependency project; FHIRBridge will then bump or override).
- Denial-of-service via legitimate flooding when no rate limit is configured beyond the default.
- Findings against forks or modified versions.

## Maintainer response timeline

Best effort; this is a single-maintainer project.

| Severity | Initial acknowledgment | Patch landed in main | Advisory issued |
| -------- | ---------------------- | -------------------- | --------------- |
| Critical | within 48 hours        | within 7 days        | with the patch  |
| High     | within 5 days          | within 14 days       | with the patch  |
| Medium   | within 14 days         | next release window  | summarized      |
| Low      | next maintenance pass  | next release window  | summarized      |

If you hear nothing within the acknowledgment window, please follow up via the same advisory thread.

## Coordinated disclosure

Default: 90 days from initial acknowledgment, or earlier if an exploit is observed in the wild. Reporters who want a different timeline can request one in the advisory.

## Credit

Reporters who follow this policy are credited in the advisory and the project changelog unless they prefer to remain anonymous. The maintainer cannot offer monetary bug bounties — the project has no budget for them.

## Vulnerabilities in dependencies

The project tracks Dependabot alerts. The maintainer applies patches via:

1. Direct dependency bump if Dependabot opens a clean PR.
2. `pnpm.overrides` for transitive dependencies whose parent already accepts the patched version.
3. Replacement PR if a Dependabot group bump fails CI.

Operators running FHIRBridge in production are encouraged to subscribe to the GitHub repo for security advisory notifications.
