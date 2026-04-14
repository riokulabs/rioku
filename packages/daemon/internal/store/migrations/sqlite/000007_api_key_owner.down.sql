DROP INDEX IF EXISTS idx_api_keys_owner;
CREATE TABLE api_keys_backup AS SELECT id, name, key_hash, scopes, expires_at, created_at, revoked_at FROM api_keys;
DROP TABLE api_keys;
CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    scopes TEXT DEFAULT '[]',
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    revoked_at TEXT
);
INSERT INTO api_keys SELECT * FROM api_keys_backup;
DROP TABLE api_keys_backup;
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_name ON api_keys(name);
