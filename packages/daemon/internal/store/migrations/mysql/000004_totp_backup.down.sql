-- 000004_totp_backup.down.sql (mysql)
DROP TABLE IF EXISTS totp_backup_codes;
DELETE FROM schema_versions WHERE version = 4;
