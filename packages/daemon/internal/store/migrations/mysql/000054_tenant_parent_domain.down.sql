-- Revert Plan 12: remove parent_domain from tenants.
ALTER TABLE tenants DROP COLUMN parent_domain;
