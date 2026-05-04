ALTER TABLE upstreams DROP COLUMN source_type;
ALTER TABLE upstreams DROP COLUMN source_json;

DELETE FROM schema_versions WHERE version = 27;
