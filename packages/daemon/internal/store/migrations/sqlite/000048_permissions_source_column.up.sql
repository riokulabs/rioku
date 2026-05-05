ALTER TABLE permissions ADD COLUMN source TEXT NOT NULL DEFAULT 'built-in'
  CHECK (source IN ('built-in', 'plugin-manifest', 'plugin-dynamic'));
ALTER TABLE permissions ADD COLUMN source_plugin_id TEXT;
CREATE INDEX IF NOT EXISTS idx_permissions_source ON permissions(source);

-- Backfill: every existing permission was registered by daemon code, so source = 'built-in'
UPDATE permissions SET source = 'built-in' WHERE source IS NULL OR source = '';
