-- Reverse migration 000052: restore NOT NULL on memberships.user_id.
DELETE FROM memberships WHERE user_id IS NULL;
ALTER TABLE memberships MODIFY COLUMN user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE;
