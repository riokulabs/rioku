-- Sprint 4 Phase 3 (#172): per-route WAF (Coraza) config + denials log.
CREATE TABLE route_waf_configs (
    route_id            VARCHAR(255) PRIMARY KEY,
    tenant_id           VARCHAR(255) NOT NULL,
    enabled             TINYINT(1) NOT NULL DEFAULT 1,
    mode                VARCHAR(16) NOT NULL DEFAULT 'block',
    rule_set            VARCHAR(64) NOT NULL DEFAULT 'crs',
    paranoia_level      INT NOT NULL DEFAULT 1,
    excluded_rule_ids   JSON NOT NULL,
    request_body_limit  INT NOT NULL DEFAULT 131072,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_route_waf_route  FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
    CONSTRAINT fk_route_waf_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_route_waf_configs_tenant ON route_waf_configs (tenant_id);

CREATE TABLE waf_denials (
    id           VARCHAR(255) PRIMARY KEY,
    tenant_id    VARCHAR(255) NOT NULL,
    route_id     VARCHAR(255),
    rule_id      VARCHAR(64) NOT NULL,
    severity     VARCHAR(16) NOT NULL,
    action       VARCHAR(16) NOT NULL,
    request_uri  TEXT NOT NULL,
    client_ip    VARCHAR(64) NOT NULL,
    matched_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata     JSON NOT NULL,
    CONSTRAINT fk_waf_denials_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_waf_denials_route  FOREIGN KEY (route_id)  REFERENCES routes(id)  ON DELETE SET NULL
);
CREATE INDEX idx_waf_denials_tenant_time ON waf_denials (tenant_id, matched_at);
CREATE INDEX idx_waf_denials_route       ON waf_denials (route_id);
CREATE INDEX idx_waf_denials_rule        ON waf_denials (rule_id);
