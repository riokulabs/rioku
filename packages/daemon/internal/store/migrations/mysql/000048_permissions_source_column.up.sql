ALTER TABLE permissions ADD COLUMN source ENUM('built-in', 'plugin-manifest', 'plugin-dynamic')
  NOT NULL DEFAULT 'built-in';
ALTER TABLE permissions ADD COLUMN source_plugin_id VARCHAR(64);
CREATE INDEX idx_permissions_source ON permissions(source);

UPDATE permissions SET source = 'built-in' WHERE source IS NULL OR source = '';
