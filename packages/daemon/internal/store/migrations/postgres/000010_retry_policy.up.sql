ALTER TABLE services ADD COLUMN retry_policy TEXT;

INSERT INTO schema_versions (version, dirty) VALUES (10, FALSE)
    ON CONFLICT (version) DO NOTHING;
