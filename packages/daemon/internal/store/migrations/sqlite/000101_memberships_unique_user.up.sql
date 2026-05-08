-- 000101: restore UNIQUE(tenant_id, user_id) on memberships.
-- The original 000013 schema declared this constraint inline. 000052
-- recreated the table to make user_id nullable and lost the constraint;
-- CreateMembership relies on it to surface ErrMembershipExists. SQLite
-- treats NULL values as distinct in UNIQUE indexes, so pending invites
-- (user_id IS NULL) remain unaffected.
CREATE UNIQUE INDEX idx_memberships_tenant_user ON memberships (tenant_id, user_id);
