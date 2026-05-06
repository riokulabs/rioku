-- Plan 12: add parent_domain to tenants for subdomain cookie scoping.
ALTER TABLE tenants ADD COLUMN parent_domain VARCHAR(255) NOT NULL DEFAULT '';
