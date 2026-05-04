-- Audit log unification (#182, D6).
-- Adds a versioned payload_schema discriminator + structured payload
-- column so audit emitters that don't fit the legacy
-- (entity_type, entity_id, diff) shape — certificate lifecycle, raft
-- state changes, action-specific structured events — can flow through
-- the same audit_log table the admin's stream / detail / export /
-- typeahead handlers already understand.
--
-- Both columns are nullable. Existing rows + emitters that still write
-- the diff column keep working unchanged. New emitters use payload +
-- payload_schema, and the admin renderer dispatches on the
-- discriminator (e.g. config.route_upserted.v1, cert.lifecycle_event.v1,
-- raft.leader_change.v1) to render the typed view.
ALTER TABLE audit_log ADD COLUMN payload_schema TEXT;
ALTER TABLE audit_log ADD COLUMN payload TEXT;
CREATE INDEX idx_audit_log_payload_schema ON audit_log (payload_schema);
