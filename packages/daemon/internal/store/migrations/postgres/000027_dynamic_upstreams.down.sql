ALTER TABLE upstreams DROP COLUMN IF EXISTS source_type;
ALTER TABLE upstreams DROP COLUMN IF EXISTS source_json;

DELETE FROM schema_versions WHERE version = 27;
