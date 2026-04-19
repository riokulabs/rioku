/**
 * Audit API hooks — backed by the Zustand mock store.
 *
 * useAuditList   — filtered + paginated audit entries (infinite-query shape)
 * useAuditEntry  — single entry by ID
 * useAuditExport — generates a Blob download for CSV or JSONL
 * useAuditTail   — live subscription via mockBus 'audit:new' topic
 */
import { useState } from 'react';
import { useMockStore } from '@/api/mock-store';
import { useSubscription } from '@/hooks/use-subscription';
import type { AuditEntryWithContext, AuditFilter, ExportFormat } from './types';
import type { AuditEntry } from '@/api/resources/types';

// ── Page size ─────────────────────────────────────────────────────────────────

export const AUDIT_PAGE_SIZE = 25;

// ── Entry enrichment ──────────────────────────────────────────────────────────

function enrichEntry(
  entry: AuditEntry,
  users: Record<string, { name: string }>,
): AuditEntryWithContext {
  const actor = users[entry.actor_id];
  return {
    ...entry,
    actor_name: actor?.name ?? entry.actor_id,
  };
}

// ── Filter predicate ──────────────────────────────────────────────────────────

function matchesFilter(entry: AuditEntry, filter: AuditFilter, tenantId: string): boolean {
  // Tenant scope: show entries for this tenant OR null-tenant (system)
  if (filter.tenant_id) {
    if (entry.tenant_id !== filter.tenant_id) return false;
  } else if (tenantId) {
    if (entry.tenant_id !== null && entry.tenant_id !== tenantId) return false;
  }

  if (filter.actions.length > 0 && !filter.actions.includes(entry.action)) return false;
  if (filter.outcomes.length > 0 && !filter.outcomes.includes(entry.outcome)) return false;
  if (filter.resource_types.length > 0 && !filter.resource_types.includes(entry.resource_type)) return false;
  if (filter.tiers.length > 0 && !filter.tiers.includes(entry.tier)) return false;
  if (filter.actor_id && entry.actor_id !== filter.actor_id) return false;
  if (filter.resource_id && entry.resource_id !== filter.resource_id) return false;
  if (filter.date_from) {
    if (new Date(entry.at) < new Date(filter.date_from)) return false;
  }
  if (filter.date_to) {
    if (new Date(entry.at) > new Date(filter.date_to)) return false;
  }

  return true;
}

// ── useAuditList ──────────────────────────────────────────────────────────────

export interface UseAuditListResult {
  /** Entries on the current page (enriched with context). */
  entries: AuditEntryWithContext[];
  /** Total count of filtered entries (across all pages). */
  total: number;
  page: number;
  pageCount: number;
  setPage: (p: number) => void;
  /** Prepend live-tail entries (returned by useAuditTail). */
  liveEntries: AuditEntryWithContext[];
  appendLive: (entry: AuditEntryWithContext) => void;
}

export function useAuditList(
  filter: AuditFilter,
  tenantId: string,
): UseAuditListResult {
  const audit = useMockStore((s) => s.audit);
  const users = useMockStore((s) => s.users);

  // Serialize filter for stable key comparison.
  const filterKey = [
    filter.actions.join(','),
    filter.outcomes.join(','),
    filter.resource_types.join(','),
    filter.tiers.join(','),
    filter.actor_id,
    filter.resource_id,
    filter.date_from,
    filter.date_to,
    filter.tenant_id,
    tenantId,
  ].join('|');

  // Pair (page, filterKey) so filter changes naturally reset page to 0.
  const [paginationState, setPaginationState] = useState({ page: 0, filterKey });

  // If the filter changed, return page 0 this render cycle.
  const activePage = paginationState.filterKey === filterKey ? paginationState.page : 0;

  const [liveEntries, setLiveEntries] = useState<AuditEntryWithContext[]>([]);
  // Reset live entries when filter key changes (caller's setFilter should reset liveEntries via appendLive)
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  const activeLiveEntries = lastFilterKey === filterKey ? liveEntries : [];

  function setPage(p: number): void {
    setPaginationState({ page: p, filterKey });
  }

  function handleFilterChange(): void {
    if (lastFilterKey !== filterKey) {
      setLastFilterKey(filterKey);
      setLiveEntries([]);
    }
  }
  // Trigger the filter change side-effect synchronously in render (React 18+ safe pattern).
  handleFilterChange();

  // Filter + enrich (newest first)
  const filtered = [...audit]
    .reverse()
    .filter((e) => matchesFilter(e, filter, tenantId))
    .map((e) => enrichEntry(e, users));

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const safePage = Math.min(activePage, pageCount - 1);
  const entries = filtered.slice(
    safePage * AUDIT_PAGE_SIZE,
    (safePage + 1) * AUDIT_PAGE_SIZE,
  );

  function appendLive(entry: AuditEntryWithContext) {
    setLiveEntries((prev) => [entry, ...prev]);
  }

  return {
    entries,
    total,
    page: safePage,
    pageCount,
    setPage,
    liveEntries: activeLiveEntries,
    appendLive,
  };
}

// ── useAuditEntry ─────────────────────────────────────────────────────────────

export function useAuditEntry(id: string): AuditEntryWithContext | null {
  const audit = useMockStore((s) => s.audit);
  const users = useMockStore((s) => s.users);
  const entry = audit.find((e) => e.id === id) ?? null;
  if (!entry) return null;
  return enrichEntry(entry, users);
}

// ── useAuditExport ────────────────────────────────────────────────────────────

/**
 * Returns a function that triggers a file download of filtered audit entries.
 * Uses URL.createObjectURL + programmatic <a download> click.
 */
export function useAuditExport(
  filter: AuditFilter,
  tenantId: string,
): {
  exportEntries: (format: ExportFormat) => void;
  count: number;
} {
  const audit = useMockStore((s) => s.audit);
  const users = useMockStore((s) => s.users);

  const filtered = [...audit]
    .reverse()
    .filter((e) => matchesFilter(e, filter, tenantId))
    .map((e) => enrichEntry(e, users));

  function exportEntries(format: ExportFormat) {
    let content: string;
    let mimeType: string;
    let filename: string;

    if (format === 'csv') {
      const headers = [
        'id', 'at', 'actor_id', 'actor_name', 'action',
        'resource_type', 'resource_id', 'outcome', 'tier', 'tenant_id',
      ];
      const rows = filtered.map((e) =>
        headers
          .map((h) => {
            const val = (e as unknown as Record<string, unknown>)[h];
            if (val === undefined || val === null) return '';
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val as string | number | boolean);
            return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
          })
          .join(','),
      );
      content = [headers.join(','), ...rows].join('\n');
      mimeType = 'text/csv';
      filename = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      content = filtered.map((e) => JSON.stringify(e)).join('\n');
      mimeType = 'application/x-ndjson';
      filename = `audit-${new Date().toISOString().slice(0, 10)}.jsonl`;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { exportEntries, count: filtered.length };
}

// ── useAuditTail ──────────────────────────────────────────────────────────────

/**
 * Subscribes to mockBus 'audit:new' events when `enabled` is true.
 * Returns new entries as they arrive.
 */
export function useAuditTail(
  enabled: boolean,
  appendLive: (entry: AuditEntryWithContext) => void,
): void {
  const users = useMockStore((s) => s.users);

  useSubscription<AuditEntry>('audit:new', (entry) => {
    if (!enabled) return;
    appendLive(enrichEntry(entry, users));
  });
}
