-- Sprint 4 Phase 1a (#164): Plans table.
--
-- A Plan is an API-management product attachment: it binds an API
-- (referenced by api_id; the APIs catalog lands as its own follow-up,
-- v1 stores api_id as a free-form TEXT pointer) to a security_type +
-- rate-limit + quota policy that consumers can subscribe to.
--
-- State machine: staging → published → deprecated → archived.
-- - staging: editable; not exposed via the consumer portal.
-- - published: visible in portal; new subscriptions allowed.
-- - deprecated: still visible to existing subscribers; no new subs.
-- - archived: terminal; subscriptions are closed; admin still sees it.
--
-- Decision (D3): trimmed Gravitee shape — api_id pointer, single
-- security_type per plan, configurable selection_rule for per-request
-- routing. PUSH plans, federated plans, T&C revisions, mTLS plans,
-- OAuth2 plans, API products, shared-key mode all deferred to v2/v3.
CREATE TABLE plans (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    api_id                TEXT NOT NULL,
    name                  TEXT NOT NULL,
    description           TEXT NOT NULL DEFAULT '',
    security_type         TEXT NOT NULL CHECK (security_type IN ('api_key', 'jwt', 'oidc', 'oauth2', 'mtls', 'none')),
    validation            TEXT NOT NULL DEFAULT 'auto' CHECK (validation IN ('auto', 'manual')),
    status                TEXT NOT NULL DEFAULT 'staging' CHECK (status IN ('staging', 'published', 'deprecated', 'archived')),
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 0,
    quota_per_day         INTEGER NOT NULL DEFAULT 0,
    selection_rule        TEXT NOT NULL DEFAULT '',
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_plans_tenant     ON plans (tenant_id);
CREATE INDEX idx_plans_api        ON plans (api_id);
CREATE INDEX idx_plans_status     ON plans (status);
CREATE UNIQUE INDEX idx_plans_tenant_name ON plans (tenant_id, name);
