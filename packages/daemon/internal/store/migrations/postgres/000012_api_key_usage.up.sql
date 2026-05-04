ALTER TABLE api_keys ADD COLUMN last_used_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0;

INSERT INTO schema_versions (version, dirty) VALUES (12, FALSE)
    ON CONFLICT (version) DO NOTHING;
