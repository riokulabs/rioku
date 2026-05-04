DROP INDEX IF EXISTS idx_middlewares_kind;
DROP INDEX IF EXISTS idx_middlewares_tenant;
DROP TABLE IF EXISTS middlewares;

DROP INDEX IF EXISTS idx_sites_domain;
DROP INDEX IF EXISTS idx_sites_tenant;
DROP TABLE IF EXISTS sites;

DELETE FROM schema_versions WHERE version = 14;
