DROP INDEX IF EXISTS idx_api_keys_owner;
ALTER TABLE api_keys DROP COLUMN IF EXISTS owner_id;
