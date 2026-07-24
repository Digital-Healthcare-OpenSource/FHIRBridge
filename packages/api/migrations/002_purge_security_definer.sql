-- purge_audit_logs phải chạy được dưới role least-privilege (fhirbridge_audit_writer
-- chỉ có INSERT/SELECT): chuyển sang SECURITY DEFINER để DELETE bên trong chạy bằng
-- quyền owner của function, search_path cố định chống hijack. Nhờ vậy scheduler
-- in-process của API (AUDIT_RETENTION_DAYS) purge được mà không cần cấp DELETE
-- trực tiếp cho role runtime.
-- purge_audit_logs must be executable by the least-privilege role
-- (fhirbridge_audit_writer has INSERT/SELECT only): SECURITY DEFINER runs the
-- DELETE with the function owner's rights, with a pinned search_path. This lets
-- the API's in-process retention scheduler (AUDIT_RETENTION_DAYS) purge without
-- granting DELETE to the runtime role.

CREATE OR REPLACE FUNCTION purge_audit_logs(retention INTERVAL)
RETURNS integer
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted integer;
BEGIN
  PERFORM set_config('fhirbridge.allow_purge', 'on', true);  -- transaction-local
  DELETE FROM audit_logs WHERE timestamp < NOW() - retention;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fhirbridge_audit_writer') THEN
    GRANT EXECUTE ON FUNCTION purge_audit_logs(INTERVAL) TO fhirbridge_audit_writer;
  END IF;
END $$;
