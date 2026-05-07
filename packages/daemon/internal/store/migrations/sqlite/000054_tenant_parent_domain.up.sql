-- Plan 12: add parent_domain to tenants for subdomain cookie scoping.
-- When url_mode=subdomain, session cookies are issued with Domain=.<parent_domain>
-- and SameSite=Lax so subdomains can share sessions.
ALTER TABLE tenants ADD COLUMN parent_domain TEXT NOT NULL DEFAULT '';
