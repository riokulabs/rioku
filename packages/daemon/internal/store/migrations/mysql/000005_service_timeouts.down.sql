ALTER TABLE services DROP COLUMN dial_timeout_seconds;
ALTER TABLE services DROP COLUMN response_header_timeout_seconds;
ALTER TABLE services DROP COLUMN idle_timeout_seconds;
DELETE FROM schema_versions WHERE version = 5;
