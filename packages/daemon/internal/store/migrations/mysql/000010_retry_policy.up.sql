ALTER TABLE services ADD COLUMN retry_policy TEXT;

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (10, 0);
