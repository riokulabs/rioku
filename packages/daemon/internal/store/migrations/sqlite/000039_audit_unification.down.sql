DROP INDEX IF EXISTS idx_audit_log_payload_schema;
ALTER TABLE audit_log DROP COLUMN payload;
ALTER TABLE audit_log DROP COLUMN payload_schema;
