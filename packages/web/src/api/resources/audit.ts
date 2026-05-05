/**
 * Audit log helpers — tenant-side and super-admin cross-tenant.
 *
 * Two-sided logging:
 *   - `logAuditEntry` writes to the main tenant `audit[]` log.
 *   - `logAdminAuditEntry` writes to the separate `adminAudit[]` log with a
 *     hash-chain so entries can be verified for tampering.
 *
 * Hash implementation: `crypto.subtle.digest('SHA-256', ...)` — available in
 * both browser and jsdom (Node 20+). Returns a Promise; both loggers are async.
 *
 * Stage-1 scope note: only impersonation enter/exit entries are emitted here.
 * Full per-mutation two-sided logging lands in 1e as features grow.
 *
 * spec §8.2 / Task 1d.77
 */

import { useMockStore } from '../mock-store';
import { makeIdFactory } from '../../lib/id-generator';
import type { ID } from './common';

// ─── Types (Plan 05 — audit) ──────────────────────────────────────────────────

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

// ─── ID factories ─────────────────────────────────────────────────────────────

const nextAuditId = makeIdFactory('audit-imp');
const nextAdminAuditId = makeIdFactory('admin-audit');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * SHA-256 hex digest of the given string.
 * Uses crypto.subtle when available (browser / jsdom), falls back to a simple
 * djb2 hex string in environments where subtle is absent.
 */
async function sha256hex(input: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback: djb2 hash (structure only — not cryptographically secure)
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Compute the hash of an AdminAuditEntry *excluding* its `hash` field.
 */
async function hashEntry(entry: Omit<AdminAuditEntry, 'hash'>): Promise<string> {
  const serialised = JSON.stringify(entry);
  return sha256hex(serialised);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface LogAuditEntryInput {
  tenant_id: string | null;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  outcome?: AuditEntry['outcome'];
  tier?: AuditEntry['tier'];
  impersonation_session_id?: string;
  acted_as_admin?: boolean;
  payload?: unknown;
}

/**
 * Write an entry to the tenant-side audit log.
 */
export function logAuditEntry(input: LogAuditEntryInput): void {
  const entry: AuditEntry = {
    id: nextAuditId(),
    tenant_id: input.tenant_id,
    actor_id: input.actor_id,
    action: input.action,
    resource_type: input.resource_type,
    ...(input.resource_id ? { resource_id: input.resource_id } : {}),
    outcome: input.outcome ?? 'success',
    at: nowIso(),
    tier: input.tier ?? 'write',
    ...(input.impersonation_session_id
      ? { impersonation_session_id: input.impersonation_session_id }
      : {}),
    ...(input.acted_as_admin ? { acted_as_admin: true } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  };
  useMockStore.getState().appendAudit(entry);
}

export interface LogAdminAuditEntryInput extends LogAuditEntryInput {
  /** Always set to 'admin' automatically. */
  kind?: 'admin';
}

/**
 * Write an entry to the super-admin cross-tenant audit log with hash-chain.
 *
 * Each entry's `prev_hash` is the `hash` of the last entry in the log (or ''
 * for the first), and `hash` is the SHA-256 of the entry content excluding
 * `hash` itself.
 *
 * Returns a Promise because SHA-256 hashing is async.
 */
export async function logAdminAuditEntry(input: LogAdminAuditEntryInput): Promise<void> {
  const state = useMockStore.getState();
  const lastEntry = state.adminAudit[state.adminAudit.length - 1];
  const prevHash = lastEntry?.hash ?? '';

  const partialEntry: Omit<AdminAuditEntry, 'hash'> = {
    id: nextAdminAuditId(),
    kind: 'admin',
    tenant_id: input.tenant_id,
    actor_id: input.actor_id,
    action: input.action,
    resource_type: input.resource_type,
    ...(input.resource_id ? { resource_id: input.resource_id } : {}),
    outcome: input.outcome ?? 'success',
    at: nowIso(),
    tier: input.tier ?? 'write',
    prev_hash: prevHash,
    ...(input.impersonation_session_id
      ? { impersonation_session_id: input.impersonation_session_id }
      : {}),
    ...(input.acted_as_admin ? { acted_as_admin: true } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  };

  const hash = await hashEntry(partialEntry);
  const entry: AdminAuditEntry = { ...partialEntry, hash };

  useMockStore.getState().appendAdminAudit(entry);
}

// ─── Chain verification ───────────────────────────────────────────────────────

export interface ChainVerificationResult {
  ok: boolean;
  /** Index of the first broken entry, or undefined if the chain is intact. */
  brokenAt?: number;
}

/**
 * Walk the admin audit chain and verify:
 *   1. Each entry's `hash` matches the SHA-256 of the entry content (sans `hash`).
 *   2. Each entry's `prev_hash` matches the prior entry's `hash` (or '' for index 0).
 *
 * Returns `{ ok: true }` if intact, or `{ ok: false, brokenAt: N }` on first failure.
 */
export async function verifyAdminAuditChain(
  entries: AdminAuditEntry[],
): Promise<ChainVerificationResult> {
  for (let i = 0; i < entries.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const entry = entries[i]!;

    // Verify prev_hash linkage
    const expectedPrevHash = i === 0 ? '' : (entries[i - 1]?.hash ?? '');
    if (entry.prev_hash !== expectedPrevHash) {
      return { ok: false, brokenAt: i };
    }

    // Recompute hash to verify content integrity — omit `hash` field
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { hash: _omitted, ...rest } = entry;
    const recomputed = await hashEntry(rest as Omit<AdminAuditEntry, 'hash'>);
    if (recomputed !== entry.hash) {
      return { ok: false, brokenAt: i };
    }
  }
  return { ok: true };
}
