-- Sprint 4 Phase 1a (#164): api_keys ↔ subscriptions linkage.
ALTER TABLE api_keys ADD COLUMN subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL;
ALTER TABLE api_keys ADD COLUMN application_id  TEXT REFERENCES applications(id) ON DELETE SET NULL;
CREATE INDEX idx_api_keys_subscription ON api_keys (subscription_id);
CREATE INDEX idx_api_keys_application  ON api_keys (application_id);
