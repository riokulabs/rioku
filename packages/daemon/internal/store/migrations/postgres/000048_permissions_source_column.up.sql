DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'permission_source') THEN
    CREATE TYPE permission_source AS ENUM ('built-in', 'plugin-manifest', 'plugin-dynamic');
  END IF;
END$$;

ALTER TABLE permissions ADD COLUMN IF NOT EXISTS source permission_source NOT NULL DEFAULT 'built-in';
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS source_plugin_id TEXT;
CREATE INDEX IF NOT EXISTS idx_permissions_source ON permissions(source);

UPDATE permissions SET source = 'built-in' WHERE source IS NULL;
