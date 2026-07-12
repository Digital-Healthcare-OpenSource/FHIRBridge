-- FHIRBridge PostgreSQL Initialization
-- Audit and operational-metrics tables only — NO PHI stored.
-- User identifiers are always HMAC-SHA256 hashes, never raw values.
--
-- IMPORTANT: this script runs ONLY on FIRST boot, when the data directory is
-- empty (Postgres executes /docker-entrypoint-initdb.d/*.sql once). Editing it
-- afterwards does NOT migrate an existing database. For schema changes on a
-- live deployment, use a migration runner — see docs/operations/upgrading.md.

-- Enable UUID / crypto helpers
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Audit Log Table ──────────────────────────────────────────────────────────
-- Records all significant user actions for compliance and debugging.
-- NO PHI: user_id_hash is HMAC-SHA256 of the real identifier.
-- This table is append-only (see immutability trigger + writer role below).
CREATE TABLE IF NOT EXISTS audit_logs (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  user_id_hash   VARCHAR(64)  NOT NULL,          -- HMAC-SHA256, not raw user ID
  action         VARCHAR(50)  NOT NULL,           -- e.g. export_start, export_complete
  resource_count INTEGER,                         -- number of FHIR resources in operation
  status         VARCHAR(20)  NOT NULL,           -- success | error | pending
  metadata       JSONB                            -- non-PHI contextual data
);

-- Index for efficient lookup by user (hashed) and time range
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_hash ON audit_logs (user_id_hash);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp  ON audit_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action      ON audit_logs (action);

-- ── Usage Tracking Table ─────────────────────────────────────────────────────
-- Records per-export operational metrics (volume + latency) for capacity
-- planning and debugging. FHIRBridge is OSS/self-host with NO billing tiers,
-- so there is no plan/tier column here.
-- NO PHI: user_id_hash is HMAC-SHA256.
CREATE TABLE IF NOT EXISTS usage_tracking (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  user_id_hash   VARCHAR(64)  NOT NULL,          -- HMAC-SHA256, not raw user ID
  export_type    VARCHAR(20)  NOT NULL,           -- fhir-json | fhir-ndjson | csv | pdf
  resource_count INTEGER      NOT NULL,           -- number of FHIR resources exported
  duration_ms    INTEGER                          -- export duration in milliseconds
);

-- Index for usage analytics queries
CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_hash ON usage_tracking (user_id_hash);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_timestamp  ON usage_tracking (timestamp DESC);

-- ── Audit Immutability (HIPAA §164.312(b) audit controls, (c) integrity) ──────
-- Audit rows are tamper-evident: no UPDATE or DELETE is permitted through the
-- normal path. Retention purges go through purge_audit_logs(), which sets a
-- transaction-local flag the trigger recognises as an authorised deletion.
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS trigger AS $$
BEGIN
  -- Allow deletes only inside an authorised retention purge (see below).
  IF TG_OP = 'DELETE'
     AND current_setting('fhirbridge.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only (attempted %); use purge_audit_logs() for retention', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- ── Retention purge ──────────────────────────────────────────────────────────
-- Deletes audit rows older than the given interval and returns the row count.
-- Retention period is jurisdiction-dependent (US HIPAA commonly 6 years, VN/JP
-- vary) — schedule this from cron/pg_cron per docs/operations/backup-restore.md.
-- Example: SELECT purge_audit_logs(INTERVAL '6 years');
CREATE OR REPLACE FUNCTION purge_audit_logs(retention INTERVAL)
RETURNS integer AS $$
DECLARE
  deleted integer;
BEGIN
  PERFORM set_config('fhirbridge.allow_purge', 'on', true);  -- transaction-local
  DELETE FROM audit_logs WHERE timestamp < NOW() - retention;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql;

-- ── Least-privilege audit writer role ────────────────────────────────────────
-- The application should connect with a login role that has been GRANTed this
-- role, so it can only INSERT/SELECT audit rows and can never UPDATE/DELETE
-- them. The immutability trigger enforces the same for every role; this adds
-- defence in depth at the privilege layer.
--   CREATE ROLE fhirbridge_app LOGIN PASSWORD '...';
--   GRANT fhirbridge_audit_writer TO fhirbridge_app;
--   -> point DATABASE_URL at fhirbridge_app
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fhirbridge_audit_writer') THEN
    CREATE ROLE fhirbridge_audit_writer NOLOGIN;
  END IF;
END $$;

GRANT INSERT, SELECT ON audit_logs     TO fhirbridge_audit_writer;
GRANT INSERT, SELECT ON usage_tracking TO fhirbridge_audit_writer;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs     FROM fhirbridge_audit_writer;
REVOKE UPDATE, DELETE, TRUNCATE ON usage_tracking FROM fhirbridge_audit_writer;

-- ── Verify Tables Created ────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'FHIRBridge audit tables initialized successfully.';
  RAISE NOTICE 'Tables: audit_logs (append-only), usage_tracking';
  RAISE NOTICE 'NO PHI is stored — user_id_hash is HMAC-SHA256 only.';
END $$;
