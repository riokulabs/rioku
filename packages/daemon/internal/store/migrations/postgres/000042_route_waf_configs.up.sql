-- Sprint 4 Phase 3 (#172): per-route WAF (Coraza) config + denials log.
CREATE TABLE route_waf_configs (
    route_id            TEXT PRIMARY KEY REFERENCES routes(id) ON DELETE CASCADE,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    enabled             BOOLEAN NOT NULL DEFAULT TRUE,
    mode                TEXT NOT NULL DEFAULT 'block' CHECK (mode IN ('block', 'detect_only')),
    rule_set            TEXT NOT NULL DEFAULT 'crs',
    paranoia_level      INTEGER NOT NULL DEFAULT 1 CHECK (paranoia_level BETWEEN 1 AND 4),
    excluded_rule_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
    request_body_limit  INTEGER NOT NULL DEFAULT 131072,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_route_waf_configs_tenant ON route_waf_configs (tenant_id);

CREATE TABLE waf_denials (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    route_id     TEXT REFERENCES routes(id) ON DELETE SET NULL,
    rule_id      TEXT NOT NULL,
    severity     TEXT NOT NULL,
    action       TEXT NOT NULL,
    request_uri  TEXT NOT NULL,
    client_ip    TEXT NOT NULL,
    matched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_waf_denials_tenant_time ON waf_denials (tenant_id, matched_at DESC);
CREATE INDEX idx_waf_denials_route       ON waf_denials (route_id);
CREATE INDEX idx_waf_denials_rule        ON waf_denials (rule_id);
