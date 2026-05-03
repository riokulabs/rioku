-- --------------------------------------------------------------------------------
-- PKI + TLS subsystem (stage-2): 4 tables.
--
-- CertAuthority: per-tenant root/intermediate CA (internal/external).
-- CertEnrollment: certificate issuance request through a CA.
-- TlsCertificate: an actual TLS cert managed by the daemon (acme or
--   manual upload), used by the auto-TLS pipeline.
-- TlsConfig: singleton-per-tenant ACME provider + cipher policy.
-- --------------------------------------------------------------------------------

CREATE TABLE cert_authorities (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    kind               TEXT NOT NULL CHECK (kind IN ('internal','external')),
    subject            TEXT NOT NULL,
    not_before         TEXT,
    not_after          TEXT,
    fingerprint_sha256 TEXT,
    certificate_pem    TEXT NOT NULL DEFAULT '',                            -- the CA cert itself
    private_key_ref    TEXT,                                                -- pointer to keyring entry, never the raw key
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE (tenant_id, name)
 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_cert_authorities_tenant ON cert_authorities (tenant_id);

CREATE TABLE cert_enrollments (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ca_id           TEXT REFERENCES cert_authorities(id) ON DELETE SET NULL,
    subject         TEXT NOT NULL,
    dns_sans        TEXT NOT NULL DEFAULT '[]',                              -- JSON array
    state           TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','issued','revoked','failed')),
    requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    issued_at       TEXT,
    revoked_at      TEXT,
    revocation_reason TEXT,
    certificate_pem TEXT NOT NULL DEFAULT '',
    chain_pem       TEXT NOT NULL DEFAULT '',
    fingerprint_sha256 TEXT,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_cert_enrollments_tenant ON cert_enrollments (tenant_id);
CREATE INDEX idx_cert_enrollments_ca     ON cert_enrollments (ca_id);

CREATE TABLE tls_certificates (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    domain             TEXT NOT NULL,
    issuer             TEXT NOT NULL DEFAULT '',
    source             TEXT NOT NULL DEFAULT 'acme' CHECK (source IN ('acme','manual')),
    expires_at         TEXT,
    auto_renew         INTEGER NOT NULL DEFAULT 1,
    fingerprint_sha256 TEXT,
    certificate_pem    TEXT NOT NULL DEFAULT '',
    private_key_ref    TEXT,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE (tenant_id, domain)
 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_tls_certificates_tenant ON tls_certificates (tenant_id);
CREATE INDEX idx_tls_certificates_expires ON tls_certificates (expires_at);

CREATE TABLE tls_configs (
    tenant_id        TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    acme_provider    TEXT NOT NULL DEFAULT 'lets-encrypt' CHECK (acme_provider IN ('lets-encrypt','zerossl','custom')),
    acme_email       TEXT NOT NULL DEFAULT '',
    acme_directory   TEXT,                                                   -- custom ACME directory URL
    allowed_ciphers  TEXT NOT NULL DEFAULT '[]',                             -- JSON array
    min_protocol     TEXT NOT NULL DEFAULT '1.2',
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (19, 0);
