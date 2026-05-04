DROP INDEX idx_api_keys_application  ON api_keys;
DROP INDEX idx_api_keys_subscription ON api_keys;
ALTER TABLE api_keys DROP FOREIGN KEY fk_api_keys_application;
ALTER TABLE api_keys DROP FOREIGN KEY fk_api_keys_subscription;
ALTER TABLE api_keys DROP COLUMN application_id;
ALTER TABLE api_keys DROP COLUMN subscription_id;
