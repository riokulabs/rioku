-- Sprint 4 Phase 1a (#164): api_keys ↔ subscriptions linkage.
--
-- Each API key now optionally belongs to a Subscription + Application
-- pair. The Sprint 3 rioku_apikey plugin's resolution chain
-- (Key → Subscription → Plan → security_type + rate_limit + quota)
-- runs once both FKs are populated.
--
-- Both columns are nullable for backward-compat: pre-Sprint-4 keys
-- continue to work as standalone scoped keys (no subscription chain).
ALTER TABLE api_keys ADD COLUMN subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL;
ALTER TABLE api_keys ADD COLUMN application_id  TEXT REFERENCES applications(id) ON DELETE SET NULL;
CREATE INDEX idx_api_keys_subscription ON api_keys (subscription_id);
CREATE INDEX idx_api_keys_application  ON api_keys (application_id);
