DROP INDEX IF EXISTS idx_api_keys_application;
DROP INDEX IF EXISTS idx_api_keys_subscription;
ALTER TABLE api_keys DROP COLUMN application_id;
ALTER TABLE api_keys DROP COLUMN subscription_id;
