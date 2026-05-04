ALTER TABLE services ADD COLUMN upstream_tls TEXT;
ALTER TABLE services ADD COLUMN connection_pool TEXT;

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (11, 0);
