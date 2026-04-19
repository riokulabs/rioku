/**
 * Audit feature types.
 * Enriches the base AuditEntry with display helpers.
 */
import type { AuditEntry } from '@/api/resources/types';

export type { AuditEntry };

/** AuditEntry with resolved display names — populated by useAuditList. */
export interface AuditEntryWithContext extends AuditEntry {
  /** Resolved display name of the actor (user name or 'System'). */
  actor_name: string;
  /** Resolved display name of the resource, if known. */
  resource_name?: string;
}

// ── Filter shape ───────────────────────────────────────────────────────────────

export interface AuditFilter {
  /** Multi-select action strings (bounded — URL-safe). */
  actions: string[];
  /** Multi-select outcome strings. */
  outcomes: AuditEntry['outcome'][];
  /** Multi-select resource type strings. */
  resource_types: string[];
  /** Multi-select tier strings. */
  tiers: AuditEntry['tier'][];
  /** Opaque actor user ID (unbounded — PII, goes through useOpaqueFilter). */
  actor_id: string;
  /** Specific resource ID (unbounded — goes through useOpaqueFilter). */
  resource_id: string;
  /** ISO date range start. */
  date_from: string;
  /** ISO date range end. */
  date_to: string;
  /** Tenant ID (super-admin only). Empty = current tenant only. */
  tenant_id: string;
}

export const DEFAULT_AUDIT_FILTER: AuditFilter = {
  actions: [],
  outcomes: [],
  resource_types: [],
  tiers: [],
  actor_id: '',
  resource_id: '',
  date_from: '',
  date_to: '',
  tenant_id: '',
};

// ── Export format ──────────────────────────────────────────────────────────────

export type ExportFormat = 'csv' | 'jsonl';
