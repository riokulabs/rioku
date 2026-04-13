-- 000006_user_deleted_status.down.sql
-- Revert 'deleted' status and restore original ENUM.

UPDATE users SET status = 'suspended' WHERE status = 'deleted';

ALTER TABLE users MODIFY COLUMN status ENUM('active','suspended','locked') NOT NULL DEFAULT 'active';

DELETE FROM schema_versions WHERE version = 6;
