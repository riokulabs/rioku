-- Reverse migration 000052: restore NOT NULL on memberships.user_id.
DELETE FROM memberships WHERE user_id IS NULL;
ALTER TABLE memberships ALTER COLUMN user_id SET NOT NULL;
