-- Migration 000052: make memberships.user_id nullable
-- Pending invites are stored without a user_id until accepted.
ALTER TABLE memberships ALTER COLUMN user_id DROP NOT NULL;
