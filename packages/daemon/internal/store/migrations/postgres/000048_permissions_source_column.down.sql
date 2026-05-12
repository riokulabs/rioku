DROP INDEX IF EXISTS idx_permissions_source;
ALTER TABLE permissions DROP COLUMN IF EXISTS source_plugin_id;
ALTER TABLE permissions DROP COLUMN IF EXISTS source;
DROP TYPE IF EXISTS permission_source;
