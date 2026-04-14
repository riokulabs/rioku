ALTER TABLE api_keys ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_api_keys_owner ON api_keys(owner_id);
INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (7, 0);
