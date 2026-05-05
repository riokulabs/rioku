DROP INDEX IF EXISTS idx_permissions_source;
ALTER TABLE permissions DROP COLUMN source_plugin_id;
ALTER TABLE permissions DROP COLUMN source;
