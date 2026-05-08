-- 000101: no-op for postgres.
-- The UNIQUE(tenant_id, user_id) constraint on memberships was declared
-- in 000013 and preserved through 000052's ALTER COLUMN ... DROP NOT NULL.
-- This file exists to keep migration version numbers in sync across
-- dialects; the corresponding sqlite migration restores the constraint
-- that sqlite lost during table recreation.
SELECT 1;
