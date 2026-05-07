-- Migration 000052: make memberships.user_id nullable
-- Pending invites are stored without a user_id until accepted.
ALTER TABLE memberships MODIFY COLUMN user_id VARCHAR(64) NULL REFERENCES users(id) ON DELETE CASCADE;
