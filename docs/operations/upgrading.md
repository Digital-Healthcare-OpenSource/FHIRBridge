# Upgrading

## Application upgrades

FHIRBridge is stateless at the application layer (zero PHI at rest). Upgrading the
API is a rolling image swap:

1. Pin to the new release **digest** (not `:latest`) — see the README quickstart.
2. Verify the cosign signature and attestations before rollout.
3. Replace the running container(s). In-flight exports live only in memory (or Redis
   with a 10-minute TTL); drain or accept that in-progress jobs restart.

No application state migrates because none is persisted.

## The database migration gap

**`docker/postgres/init.sql` runs on first boot only.** Postgres executes files in
`/docker-entrypoint-initdb.d/` exactly once — when the data directory is empty. On
every subsequent start it is ignored.

Consequences you must plan around:

- Editing `init.sql` does **not** change an existing database. A running deployment
  keeps whatever schema it was first created with.
- There is currently **no migration runner** in the project. Schema changes between
  versions (new columns, new triggers, changes to `purge_audit_logs()`) are not
  applied automatically to an existing audit DB.

### Applying schema changes to an existing database

Until a migration runner is adopted, apply changes manually and deliberately:

1. Take a fresh backup first (see [backup-restore.md](backup-restore.md)).
2. Diff the new `init.sql` against what the live DB already has.
3. Apply only the delta as an idempotent script, e.g.:

   ```bash
   PGPASSWORD="$POSTGRES_PASSWORD" psql \
     -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -v ON_ERROR_STOP=1 -f ./migrations/2026-07-add-something.sql
   ```

   Write each migration to be safe to re-run (`CREATE ... IF NOT EXISTS`,
   `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`),
   mirroring the style already used in `init.sql`.

### Built-in migration runner

FHIRBridge ships a minimal, dependency-free migration runner:

```bash
# DATABASE_URL must point at a DDL-capable role (NOT the restricted
# fhirbridge_audit_writer runtime role).
DATABASE_URL=postgres://admin:...@db/fhirbridge \
  pnpm --filter @fhirbridge/api migrate
```

- Migrations live in `packages/api/migrations/NNN_name.sql`, applied in order,
  one transaction each, recorded in `schema_migrations` (version, name,
  SHA-256 checksum, applied_at).
- **Idempotent**: re-running is a no-op. `001_baseline.sql` mirrors `init.sql`
  (both use `IF NOT EXISTS` guards — a CI test keeps their checksums in sync),
  so running against a database initialised by first-boot `init.sql` is safe.
- **Drift detection**: editing an already-applied migration fails the run —
  always add a new numbered file instead.
- **Multi-replica safe**: a Postgres advisory lock serialises concurrent runs.
- Run it as an init container (or manually) **before** rolling the new API image.

Rules for writing migrations: keep `audit_logs` **append-only** (retain the
immutability trigger), and never write a migration that mutates historical
audit rows.

## Redis

Redis holds only ephemeral data with persistence disabled — there is nothing to
migrate. On upgrade, just restart the container; caches rebuild on demand.
