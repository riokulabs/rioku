CREATE TABLE api_keys_backup AS SELECT id, name, key_hash, scopes, expires_at, created_at, revoked_at, owner_id FROM api_keys;
DROP TABLE api_keys;
ALTER TABLE api_keys_backup RENAME TO api_keys;
CREATE INDEX idx_api_keys_key_hash ON api_keys (key_hash);
CREATE INDEX idx_api_keys_name     ON api_keys (name);
DELETE FROM schema_versions WHERE version = 12;
