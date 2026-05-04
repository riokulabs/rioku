ALTER TABLE services ADD COLUMN passive_health_check TEXT;

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (9, 0);
