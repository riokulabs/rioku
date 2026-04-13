-- 000006_user_deleted_status.up.sql
-- Add 'deleted' to the user status ENUM.

ALTER TABLE users MODIFY COLUMN status ENUM('active','suspended','locked','deleted') NOT NULL DEFAULT 'active';

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (6, 0);
