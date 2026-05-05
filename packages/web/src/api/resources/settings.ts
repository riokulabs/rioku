// Owned by Plan 07 (settings) — types for the settings resource surface.

import type { ID, LogLevel } from './common';

/**
 * Per-tenant authentication policy. Applies to all users in the tenant
 * except where super-admin overrides.
 */
export interface TenantAuthPolicy {
  readonly tenant_id: ID;
  /** TOTP enforcement. `all`=every user, `admins`=admin-role users only, `optional`=per-user choice. */
  totp_policy: 'all' | 'admins' | 'optional';
  password_policy: {
    min_length: number; // 6..128
    require_uppercase: boolean;
    require_digit: boolean;
    require_symbol: boolean;
    max_age_days: number; // 0 = never expires
    history_depth: number; // 0..24
  };
  session_timeouts: {
    idle_hours: number; // 0..168 (7 days)
    absolute_hours: number; // 1..720 (30 days)
  };
  readonly updated_at: string;
}

/**
 * Per-tenant network configuration. Applies to the Caddy managed process
 * and upstream connections.
 */
export interface NetworkConfig {
  readonly tenant_id: ID;
  /** Daemon listen addresses — tuples of address + port (e.g. ':443'). Read-only in stage 1. */
  listen_addresses: string[];
  /** Caddy JSON config overrides. Free-form JSON string (not parsed at stage 1). */
  caddy_config_overrides: string;
  http3_enabled: boolean;
  /** Default upstream timeouts in seconds. */
  upstream_timeouts: {
    connect: number; // 1..300
    read: number; // 1..3600
    write: number; // 1..3600
    idle: number; // 1..3600
  };
  readonly updated_at: string;
}

/**
 * Certificate Authority. `internal` is the Rioku-managed CA seeded by default;
 * `external` represents an operator-imported CA (e.g., a Let's Encrypt chain
 * or corporate issuer).
 */
export interface CertAuthority {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  kind: 'internal' | 'external';
  subject: string; // e.g. "CN=Rioku Internal Root CA"
  issuer: string; // same as subject for self-signed
  /** Not-before / not-after in ISO-8601 */
  not_before: string;
  not_after: string;
  /** Fake-looking SHA-256 hex (64 chars) — no real crypto in mock */
  fingerprint_sha256: string;
  /** For external CAs, the PEM blob the operator pasted. Empty for internal. */
  certificate_pem: string;
  /** True once the CA has been revoked. Existing certs already issued continue
   *  to be valid until they expire, but no new enrollments are allowed. */
  revoked?: boolean;
  /** ISO-8601 revocation timestamp. */
  revoked_at?: string;
  /** Operator-supplied reason for revocation. */
  revocation_reason?: string;
  readonly created_at: string;
}

/**
 * Certificate enrollment. Represents a pending, issued, or revoked cert
 * request managed by Rioku's PKI.
 */
export interface CertEnrollment {
  readonly id: ID;
  readonly tenant_id: ID;
  readonly ca_id: ID; // FK to CertAuthority
  subject: string; // CN/SAN summary
  dns_sans: string[];
  state: 'pending' | 'issued' | 'revoked';
  /** ISO-8601 timestamps; null when state hasn't reached that point */
  requested_at: string;
  issued_at?: string;
  revoked_at?: string;
  revocation_reason?: string;
  /** Fingerprint populated once issued */
  fingerprint_sha256?: string;
}

/**
 * TLS certificate. Represents an issued cert for a domain — either ACME-automated
 * or operator-uploaded manually.
 */
export interface TlsCertificate {
  readonly id: ID;
  readonly tenant_id: ID;
  domain: string; // e.g. "api.example.com"
  /** e.g. "Let's Encrypt", "ZeroSSL", "Self-signed", or "Manual" */
  issuer: string;
  source: 'acme' | 'manual';
  /** ISO-8601 */
  issued_at: string;
  expires_at: string;
  /** Only applies to acme source. Stage-1 toggle only. */
  auto_renew: boolean;
  /** Cert PEM (for manual uploads; empty for ACME-managed). */
  certificate_pem: string;
  /** Fake SHA-256 hex (64 chars) */
  fingerprint_sha256: string;
  readonly created_at: string;
}

/**
 * Per-tenant observability configuration. Covers metrics, logs, and traces.
 * Audit retention is stored separately in AuditRetentionConfig (Plan 5).
 */
export interface ObservabilityConfig {
  readonly tenant_id: ID;
  metrics: {
    /** Prometheus scrape endpoint path (e.g. '/metrics'). */
    scrape_endpoint: string;
    /** Scrape-side auth mode. */
    scrape_auth: 'none' | 'bearer' | 'mtls';
    /** Days of metric retention. */
    retention_days: number;
  };
  logs: {
    /** Log level per component (daemon / caddy / plugin). */
    levels: {
      daemon: LogLevel;
      caddy: LogLevel;
      plugin: LogLevel;
    };
    /** 'json' = structured, 'text' = plain. */
    format: 'json' | 'text';
    rotation: {
      max_size_mb: number; // 1..1024
      max_backups: number; // 0..100
      max_age_days: number; // 0..365 (0 = disabled)
      compress: boolean;
    };
  };
  traces: {
    retention_days: number; // 0..365 (0 = disabled)
    /** Sample rate 0.0 - 1.0; 1.0 = every trace. */
    sample_rate: number;
  };
  readonly updated_at: string;
}

/**
 * External inbound webhook endpoint. Stage-1 placeholder — real handler
 * registration happens at stage 2+.
 */
export interface WebhookEndpoint {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  path: string; // e.g. "/webhooks/github-events"
  /** Stage-1 placeholder — static list in UI; not consulted at runtime. */
  expected_event_types: string[];
  secret: string; // fake random 32-char hex
  enabled: boolean;
  readonly created_at: string;
}

/**
 * Per-tenant ACME + TLS configuration.
 */
export interface TlsConfig {
  readonly tenant_id: ID;
  acme: {
    provider: 'lets-encrypt' | 'zerossl' | 'custom';
    /** Account email for ACME registration */
    email: string;
    /** For provider='custom', the ACME directory URL */
    directory_url?: string;
    /** When true, use DNS-01 challenge instead of HTTP-01 */
    dns_challenge: boolean;
  };
  /** Allowed TLS 1.2/1.3 cipher suites (openssl-style names). */
  allowed_ciphers: string[];
  readonly updated_at: string;
}
