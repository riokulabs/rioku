DROP INDEX idx_audit_log_payload_schema ON audit_log;
ALTER TABLE audit_log DROP COLUMN payload;
ALTER TABLE audit_log DROP COLUMN payload_schema;
