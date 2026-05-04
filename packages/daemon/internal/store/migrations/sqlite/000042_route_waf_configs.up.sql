-- Sprint 4 Phase 3 (#172): per-route WAF (Coraza) config.
--
-- Coraza is bundled in the daemon's xcaddy build (per the
-- 2026-04-06 default-Caddy-plugins decision). This table holds
-- the per-route enable + paranoia + excluded-rules + body-size
-- knobs the admin REST surface exposes.
--
-- mode: "block" rejects matched requests with 403; "detect_only"
-- logs the match but lets the request through (useful while
-- tuning rule sets).
--
-- excluded_rule_ids is a JSON array of OWASP CRS rule IDs
-- (e.g. [\"941100\", \"941110\"]) that operators want suppressed
-- — handy for taming false positives without disabling the
-- whole rule class.
CREATE TABLE route_waf_configs (
    route_id            TEXT PRIMARY KEY REFERENCES routes(id) ON DELETE CASCADE,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    enabled             INTEGER NOT NULL DEFAULT 1,
    mode                TEXT NOT NULL DEFAULT 'block' CHECK (mode IN ('block', 'detect_only')),
    rule_set            TEXT NOT NULL DEFAULT 'crs',
    paranoia_level      INTEGER NOT NULL DEFAULT 1 CHECK (paranoia_level BETWEEN 1 AND 4),
    excluded_rule_ids   TEXT NOT NULL DEFAULT '[]',
    request_body_limit  INTEGER NOT NULL DEFAULT 131072,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_route_waf_configs_tenant ON route_waf_configs (tenant_id);

-- waf_denials: an append-only log of WAF rule matches. The Coraza
-- handler emits one row per match (when in detect_only mode) or
-- per blocked request (when in block mode). The admin's "Security
-- timeline" page reads this; pruning piggybacks on the existing
-- audit_retention_config.
CREATE TABLE waf_denials (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    route_id     TEXT REFERENCES routes(id) ON DELETE SET NULL,
    rule_id      TEXT NOT NULL,
    severity     TEXT NOT NULL,
    action       TEXT NOT NULL, -- "block" | "log"
    request_uri  TEXT NOT NULL,
    client_ip    TEXT NOT NULL,
    matched_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    metadata     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_waf_denials_tenant_time ON waf_denials (tenant_id, matched_at DESC);
CREATE INDEX idx_waf_denials_route       ON waf_denials (route_id);
CREATE INDEX idx_waf_denials_rule        ON waf_denials (rule_id);
