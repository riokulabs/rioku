ALTER TABLE services ADD COLUMN passive_health_check TEXT;

INSERT INTO schema_versions (version, dirty) VALUES (9, FALSE)
    ON CONFLICT (version) DO NOTHING;
