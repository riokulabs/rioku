-- Audit log unification (#182, D6).
ALTER TABLE audit_log ADD COLUMN payload_schema VARCHAR(255) NULL;
ALTER TABLE audit_log ADD COLUMN payload JSON NULL;
CREATE INDEX idx_audit_log_payload_schema ON audit_log (payload_schema);
