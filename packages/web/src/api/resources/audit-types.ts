// Owned by Plan 05 (audit) — types for the audit resource surface.

import type { ID } from './common';

export interface AuditEntry {
  readonly id: ID;
  readonly tenant_id: ID | null;
  readonly actor_id: ID;
  action: string;
  resource_type: string;
  resource_id?: ID;
  outcome: 'success' | 'denied' | 'error';
  readonly at: string;
  tier: 'read' | 'read-sensitive' | 'write' | 'destructive';
  impersonation_session_id?: ID;
  /** Set to true when a super-admin action is reflected into the tenant log */
  acted_as_admin?: boolean;
  payload?: unknown;
  diff?: { before: unknown; after: unknown };
  // Plan 5 additions:
  /** Correlates this audit entry with a gateway request id. */
  request_id?: string;
  /** Caller IP as observed at the gateway. Sensitive — masked without `audit:read-sensitive`. */
  ip?: string;
  /** Caller user-agent string. Sensitive — masked without `audit:read-sensitive`. */
  user_agent?: string;
  /** True when the actor confirmed TOTP within this request's auth chain. */
  totp_verified?: boolean;
  /** Access + RBAC policies evaluated for this request, with per-policy decision. */
  policies_evaluated?: {
    readonly policy_id: ID;
    decision: 'allow' | 'deny';
    reason?: string;
  }[];
}

/**
 * Tenant-scoped audit retention configuration.
 *
 * One row per tenant controls how long audit entries are kept (per tier) and
 * how / whether they are auto-exported. Enforcement is a Stage 2+ daemon cron
 * — Stage 1 only persists the policy.
 */
export interface AuditRetentionConfig {
  readonly tenant_id: ID;
  /** Days to retain per tier. */
  retention_days: {
    read: number;
    'read-sensitive': number;
    write: number;
    destructive: number;
  };
  /** Export cadence. `never` disables the auto-export job. */
  auto_export: 'daily' | 'weekly' | 'monthly' | 'never';
  auto_export_format: 'csv' | 'jsonl';
  readonly updated_at: string;
}

/**
 * Admin-side audit entry — extends AuditEntry with hash-chain fields.
 * Written to the separate adminAudit log in the mock store.
 */
export interface AdminAuditEntry extends AuditEntry {
  /** kind discriminator — always 'admin' */
  kind: 'admin';
  /** SHA-256 (hex) of the previous entry's content, or empty string for the first */
  prev_hash: string;
  /** SHA-256 (hex) of this entry's content (excluding `hash` itself) */
  hash: string;
}
