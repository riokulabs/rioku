ALTER TABLE api_keys DROP FOREIGN KEY fk_api_keys_owner;
DROP INDEX idx_api_keys_owner ON api_keys;
ALTER TABLE api_keys DROP COLUMN owner_id;
