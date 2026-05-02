-- Audit log unification (#182, D6).
ALTER TABLE audit_log ADD COLUMN payload_schema TEXT;
ALTER TABLE audit_log ADD COLUMN payload JSONB;
CREATE INDEX idx_audit_log_payload_schema ON audit_log (payload_schema);
