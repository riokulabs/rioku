-- Sprint 4 Phase 1a (#164): api_keys ↔ subscriptions linkage.
ALTER TABLE api_keys ADD COLUMN subscription_id VARCHAR(255) NULL;
ALTER TABLE api_keys ADD COLUMN application_id  VARCHAR(255) NULL;
ALTER TABLE api_keys ADD CONSTRAINT fk_api_keys_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL;
ALTER TABLE api_keys ADD CONSTRAINT fk_api_keys_application  FOREIGN KEY (application_id)  REFERENCES applications(id)  ON DELETE SET NULL;
CREATE INDEX idx_api_keys_subscription ON api_keys (subscription_id);
CREATE INDEX idx_api_keys_application  ON api_keys (application_id);
