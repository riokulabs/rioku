ALTER TABLE api_keys ADD COLUMN last_used_at TEXT;
ALTER TABLE api_keys ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0;

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (12, 0);
