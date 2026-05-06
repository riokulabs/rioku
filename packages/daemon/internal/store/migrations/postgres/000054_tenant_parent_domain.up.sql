-- Plan 12: add parent_domain to tenants for subdomain cookie scoping.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS parent_domain TEXT NOT NULL DEFAULT '';
