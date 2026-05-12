DROP INDEX idx_permissions_source ON permissions;
ALTER TABLE permissions DROP COLUMN source_plugin_id;
ALTER TABLE permissions DROP COLUMN source;
