-- 000006_user_deleted_status.down.sql
-- Revert 'deleted' status and restore original CHECK constraint.

UPDATE users SET status = 'suspended' WHERE status = 'deleted';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'locked'));

DELETE FROM schema_versions WHERE version = 6;
