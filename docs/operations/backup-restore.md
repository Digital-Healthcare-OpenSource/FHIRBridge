# Backup & Restore — Audit Database

The Postgres `audit_logs` table is FHIRBridge's **only durable record**. Because
the system holds zero PHI at rest, the audit log is your sole evidence of who did
what and when — required for HIPAA §164.312(b) audit controls and equivalent
VN/JP obligations. Losing the disk without a backup means losing that evidence.

Postgres stores **no PHI**: `user_id_hash` is an HMAC-SHA256 value, not a raw
identifier. Backups are therefore not PHI, but they are compliance-sensitive —
store them encrypted and access-controlled.

## What to back up

- **`audit_logs`** — mandatory. Append-only, tamper-evident (immutability trigger).
- **`usage_tracking`** — optional operational metrics (volume + latency, no billing).

Redis holds only ephemeral, in-RAM data (persistence disabled, `/data` is tmpfs) —
there is nothing to back up and nothing should be persisted.

## Nightly logical backup (`pg_dump`)

```bash
#!/usr/bin/env bash
# /etc/cron.daily/fhirbridge-audit-backup  (chmod 700, run as a trusted user)
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="/var/backups/fhirbridge"
mkdir -p "$DEST"

# Custom format (-Fc) → compressed, supports selective restore.
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -Fc -f "$DEST/audit-$STAMP.dump"

# Encrypt at rest (age/gpg). Example with age:
age -r "$BACKUP_AGE_RECIPIENT" -o "$DEST/audit-$STAMP.dump.age" "$DEST/audit-$STAMP.dump"
rm -f "$DEST/audit-$STAMP.dump"

# Prune local copies older than 35 days (retention below governs the DB itself).
find "$DEST" -name 'audit-*.dump.age' -mtime +35 -delete
```

Ship the encrypted dumps off-host (object storage with versioning + lifecycle) so a
single-host failure does not lose history.

## Retention

Retention is **jurisdiction-dependent** — set it to the longest rule that applies to
where your patients and facility are:

| Jurisdiction | Common audit retention                | Note                                     |
| ------------ | ------------------------------------- | ---------------------------------------- |
| US (HIPAA)   | 6 years                               | §164.316(b)(2) — documentation retention |
| Vietnam      | Per Nghị định 102/2025 & sector rules | Confirm the current medical-record rule  |
| Japan        | Per MHLW medical-record rules         | Often 5+ years; confirm current guidance |

> This table is operational guidance, not legal advice. Confirm the binding period
> with your compliance officer before setting a purge interval.

### Purging expired audit rows

`audit_logs` is append-only: direct `DELETE`/`UPDATE` is blocked by the immutability
trigger. Retention purges go through the `purge_audit_logs()` function shipped in
`docker/postgres/init.sql`, which performs an authorised deletion of rows older than
the given interval:

```sql
-- Delete audit rows older than 6 years, return the number removed.
SELECT purge_audit_logs(INTERVAL '6 years');
```

Schedule it (cron or `pg_cron`), e.g. monthly:

```sql
-- with pg_cron installed
SELECT cron.schedule('audit-purge', '0 3 1 * *',
                     $$SELECT purge_audit_logs(INTERVAL '6 years')$$);
```

**Purge only what your backups already cover** — take the nightly dump before the
monthly purge so removed rows still exist in an archived backup for the full legal
window if you keep dumps longer than the live retention.

## Restore drill

Test restores on a schedule (quarterly). An untested backup is not a backup.

```bash
# 1. Decrypt.
age -d -i "$BACKUP_AGE_KEY" -o /tmp/audit-restore.dump "$DEST/audit-<stamp>.dump.age"

# 2. Restore into a scratch database and verify.
createdb -h 127.0.0.1 -U "$POSTGRES_USER" fhirbridge_restore_test
PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
  -h 127.0.0.1 -U "$POSTGRES_USER" -d fhirbridge_restore_test \
  --no-owner /tmp/audit-restore.dump

# 3. Sanity-check row counts and the newest entry.
psql -h 127.0.0.1 -U "$POSTGRES_USER" -d fhirbridge_restore_test \
  -c "SELECT count(*), max(timestamp) FROM audit_logs;"

# 4. Tear down.
dropdb -h 127.0.0.1 -U "$POSTGRES_USER" fhirbridge_restore_test
rm -f /tmp/audit-restore.dump
```

Record each drill (date, dump restored, row count, pass/fail) — that record is itself
useful compliance evidence.

## Korea (KR) profile — access-log retention ≥ 2 years

With `AUDIT_PROFILE=kr`, every audit row's `metadata` JSONB additionally carries
`patientRefHash` (HMAC of the accessed patient id — never the raw id) and
`sourceIp`, per the KR 개인정보의 안전성 확보조치 access-log requirement
(who / when / whose record / from where).

Operational consequences for Korean deployments:

- **Retention**: keep audit rows **at least 2 years** (medical-sector guidance).
  Do NOT schedule `purge_audit_logs()` with a window shorter than 730 days, and
  set `AUDIT_RETENTION_DAYS=730` (or more) so no automated job deletes rows early.
- **Periodic review**: the standard expects regular access-log review. A monthly
  query such as
  `SELECT date_trunc('day', timestamp), count(*) FROM audit_logs GROUP BY 1 ORDER BY 1`
  plus spot checks on `metadata->>'patientRefHash'` clusters is a reasonable
  baseline; record each review like a backup drill.
- **Partitioning**: at 2-year retention, consider native range partitioning by
  month on `timestamp` to keep purges cheap (`DROP PARTITION` instead of
  `DELETE`). Introduce it via the schema-change path in [upgrading.md](upgrading.md).
- **GDPR trade-off**: `sourceIp` is personal data under GDPR. The field exists
  ONLY under the KR profile — leave `AUDIT_PROFILE` unset for EU-adjacent
  deployments, or document your lawful basis before enabling it.

## Note on `init.sql`

`docker/postgres/init.sql` runs **only on first boot** (empty data directory). It
creates the tables, the immutability trigger, and `purge_audit_logs()`. A restore
into an already-initialised database will not re-run it — see
[upgrading.md](upgrading.md) for how schema changes reach an existing database.
