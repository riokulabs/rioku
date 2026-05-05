/**
 * Audit API layer — read-only list + streaming tail + async-search +
 * export + retention-config CRUD.
 *
 * Backed by the Zustand mock store and the module-level audit-stream bus.
 * Exports are shaped like Plan 3d's trace API so the in-browser UX can
 * swap in a real daemon-backed implementation with minimal churn.
 *
 * Opaque-handle convention (§13.2a):
 *   actor:        user_<user_id>
 *   resource_id:  res_<resource_type>_<resource_id>
 */
import { useMemo, useState, useCallback } from 'react';
import { useMockStore } from '@/api/mock-store';
import { AUDIT_STREAM_TOPIC, auditStreamBus, publishAudit } from '@/api/audit-stream-bus';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import { resolveRolePermissions } from '@/host/role-resolver';
import type { AuditEntry, AuditRetentionConfig, ID } from '@/api/resources';
import type {
  ActorCandidate,
  AsyncSearchPage,
  AuditFilter,
  AuditListInfiniteResult,
  AuditStreamListener,
  ResourceIdCandidate,
  UpdateRetentionConfigInput,
} from './types';

const nextAuditId = makeIdFactory('audit-new');

// ─── Handle codec ─────────────────────────────────────────────────────────────

/** Encode a user id into an opaque audit-filter handle. */
export function encodeActorHandle(userId: ID): string {
  return `user_${userId}`;
}

/** Decode an opaque actor handle back to the underlying user id. */
export function decodeActorHandle(handle: string): ID | null {
  if (!handle.startsWith('user_')) return null;
  return handle.slice('user_'.length);
}

/** Encode a (resource_type, resource_id) pair into an opaque filter handle. */
export function encodeResourceHandle(resourceType: string, resourceId: ID): string {
  return `res_${resourceType}_${resourceId}`;
}

/** Decode an opaque resource handle back to `{ resource_type, resource_id }`. */
export function decodeResourceHandle(
  handle: string,
): { resource_type: string; resource_id: ID } | null {
  if (!handle.startsWith('res_')) return null;
  const rest = handle.slice('res_'.length);
  const sepIdx = rest.indexOf('_');
  if (sepIdx === -1) return null;
  return {
    resource_type: rest.slice(0, sepIdx),
    resource_id: rest.slice(sepIdx + 1),
  };
}

// ─── Permission helper (sync, for exports) ──────────────────────────────────

/**
 * Synchronously check whether the current session holds a permission on
 * the current tenant. Mirrors the resolution path used by `usePermission`
 * but reads state imperatively — safe for export helpers that can't sit
 * inside a React render.
 */
function currentUserHasPermission(key: string): boolean {
  const s = useMockStore.getState();
  if (!s.currentUserId) return false;
  const memberships = Object.values(s.memberships).filter(
    (m) =>
      m.user_id === s.currentUserId && m.tenant_id === s.currentTenantId && m.state === 'active',
  );
  const roleIds = memberships.flatMap((m) => m.role_ids);
  return resolveRolePermissions(roleIds, s.roles).has(key);
}

// ─── Filter matcher ──────────────────────────────────────────────────────────

function matchesFilter(entry: AuditEntry, tenantId: string, filter: AuditFilter): boolean {
  if (entry.tenant_id !== tenantId) return false;

  if (filter.actions.length > 0 && !filter.actions.includes(entry.action)) {
    return false;
  }
  if (filter.outcomes.length > 0 && !filter.outcomes.includes(entry.outcome)) {
    return false;
  }
  if (filter.resource_types.length > 0 && !filter.resource_types.includes(entry.resource_type)) {
    return false;
  }
  if (filter.tiers.length > 0 && !filter.tiers.includes(entry.tier)) {
    return false;
  }

  if (filter.date_from !== null && entry.at < filter.date_from) return false;
  if (filter.date_to !== null && entry.at >= filter.date_to) return false;

  if (filter.actor_handles.length > 0) {
    const actorIds = filter.actor_handles
      .map(decodeActorHandle)
      .filter((id): id is ID => id !== null);
    if (!actorIds.includes(entry.actor_id)) return false;
  }

  if (filter.resource_id_handles.length > 0) {
    const ok = filter.resource_id_handles.some((h) => {
      const decoded = decodeResourceHandle(h);
      if (!decoded) return false;
      return (
        decoded.resource_type === entry.resource_type && decoded.resource_id === entry.resource_id
      );
    });
    if (!ok) return false;
  }

  const search = filter.search.trim().toLowerCase();
  if (search) {
    const fields: string[] = [
      entry.action,
      entry.resource_type,
      entry.resource_id ?? '',
      entry.outcome,
    ];
    // Payload search is only available with audit:read-sensitive; the
    // filter bar permission-gates the input but we re-check here so
    // programmatic callers can't bypass the guard.
    if (currentUserHasPermission('audit:read-sensitive')) {
      if (entry.payload !== undefined) {
        fields.push(JSON.stringify(entry.payload));
      }
      if (entry.ip) fields.push(entry.ip);
      if (entry.user_agent) fields.push(entry.user_agent);
    }
    const hay = fields.join(' ').toLowerCase();
    if (!hay.includes(search)) return false;
  }

  return true;
}

function sortDesc(a: AuditEntry, b: AuditEntry): number {
  return a.at < b.at ? 1 : a.at > b.at ? -1 : 0;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * All audit entries for `tenantId` matching the filter, sorted desc by `at`.
 *
 * The Zustand selector only grabs the raw audit array; filtering + sorting
 * happen outside the selector so the hook identity is stable when unrelated
 * store slices update.
 */
export function useAuditList(tenantId: string, filter: AuditFilter): AuditEntry[] {
  const audit = useMockStore((s) => s.audit);
  return useMemo(() => {
    const out: AuditEntry[] = [];
    for (const entry of audit) {
      if (matchesFilter(entry, tenantId, filter)) out.push(entry);
    }
    out.sort(sortDesc);
    return out;
  }, [audit, tenantId, filter]);
}

/**
 * Paginated variant of {@link useAuditList}. Returns the TanStack-Query-
 * shaped triple `{ data, fetchNextPage, hasNextPage, isFetching }` but
 * resolves synchronously against the mock store. Stage 2 can replace the
 * body with a real `useInfiniteQuery` without touching call sites.
 */
export function useAuditListInfinite(
  tenantId: string,
  filter: AuditFilter,
  pageSize: number,
): AuditListInfiniteResult {
  const full = useAuditList(tenantId, filter);
  const [pages, setPages] = useState(1);

  // When the filter reference changes we want to reset to page 1. Use the
  // `full.length` + a stable reset key derived from filter identity.
  const currentSlice = useMemo(() => full.slice(0, pages * pageSize), [full, pages, pageSize]);

  const hasNextPage = currentSlice.length < full.length;

  const fetchNextPage = useCallback(() => {
    setPages((p) => p + 1);
  }, []);

  return {
    data: currentSlice,
    fetchNextPage,
    hasNextPage,
    isFetching: false,
  };
}

/** Detail selector — returns the audit entry with id `entryId`, or undefined. */
export function useAuditDetail(entryId: string): AuditEntry | undefined {
  const audit = useMockStore((s) => s.audit);
  return useMemo(() => audit.find((e) => e.id === entryId), [audit, entryId]);
}

// ─── Streaming tail ──────────────────────────────────────────────────────────

/**
 * Subscribe to newly-emitted audit entries for the given tenant. Fires
 * `onEntry` for each `publishAudit` call whose entry's `tenant_id`
 * matches (including the `null` super-admin case when `tenantId === null`).
 * Returns an unsubscribe function.
 */
export function subscribeAuditStream(tenantId: string, onEntry: AuditStreamListener): () => void {
  const handler = (e: Event): void => {
    const detail = (e as CustomEvent<AuditEntry>).detail;
    if (detail.tenant_id !== tenantId) return;
    onEntry(detail);
  };
  auditStreamBus.addEventListener(AUDIT_STREAM_TOPIC, handler);
  return () => {
    auditStreamBus.removeEventListener(AUDIT_STREAM_TOPIC, handler);
  };
}

// ─── Export ──────────────────────────────────────────────────────────────────

/** CSV-escape a cell per RFC 4180. */
function csvEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_HEADER = 'at,actor_id,action,resource_type,resource_id,outcome,tier,ip,request_id';

const REDACTED = '[redacted]';

/**
 * Build a CSV blob from audit entries matching `filter` for `tenantId`.
 *
 * Permission-aware: when the current session lacks `audit:read-sensitive`,
 * the `ip` column is replaced with `[redacted]`. `user_agent` is not a CSV
 * column; the JSONL export carries the full (redacted) shape.
 */
export function exportAuditCsv(tenantId: string, filter: AuditFilter): Blob {
  const canReadSensitive = currentUserHasPermission('audit:read-sensitive');
  const state = useMockStore.getState();

  const matched: AuditEntry[] = [];
  for (const entry of state.audit) {
    if (matchesFilter(entry, tenantId, filter)) matched.push(entry);
  }
  matched.sort(sortDesc);

  const rows: string[] = [CSV_HEADER];
  for (const e of matched) {
    const ipCell = canReadSensitive ? (e.ip ?? '') : e.ip ? REDACTED : '';
    rows.push(
      [
        csvEscape(e.at),
        csvEscape(e.actor_id),
        csvEscape(e.action),
        csvEscape(e.resource_type),
        csvEscape(e.resource_id ?? ''),
        csvEscape(e.outcome),
        csvEscape(e.tier),
        csvEscape(ipCell),
        csvEscape(e.request_id ?? ''),
      ].join(','),
    );
  }

  return new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
}

/**
 * Build a JSONL (newline-delimited JSON) blob from audit entries matching
 * `filter` for `tenantId`. One JSON object per line, full shape, with PII
 * redaction when the current session lacks `audit:read-sensitive`:
 *
 *   - `ip`         → `[redacted]`
 *   - `user_agent` → `[redacted]`
 *   - `payload`    → `null`
 */
export function exportAuditJsonl(tenantId: string, filter: AuditFilter): Blob {
  const canReadSensitive = currentUserHasPermission('audit:read-sensitive');
  const state = useMockStore.getState();

  const matched: AuditEntry[] = [];
  for (const entry of state.audit) {
    if (matchesFilter(entry, tenantId, filter)) matched.push(entry);
  }
  matched.sort(sortDesc);

  const lines: string[] = [];
  for (const e of matched) {
    const out: AuditEntry = canReadSensitive
      ? e
      : {
          ...e,
          ...(e.ip !== undefined ? { ip: REDACTED } : {}),
          ...(e.user_agent !== undefined ? { user_agent: REDACTED } : {}),
          ...(e.payload !== undefined ? { payload: null } : {}),
        };
    lines.push(JSON.stringify(out));
  }

  return new Blob([lines.join('\n')], {
    type: 'application/x-ndjson;charset=utf-8',
  });
}

// ─── Async search (unbounded MultiSelect) ────────────────────────────────────

const DEFAULT_PAGE_SIZE = 25;

function sliceCursor<T>(
  items: T[],
  cursor: string | undefined,
  pageSize: number,
): AsyncSearchPage<T> {
  const start = cursor ? Number.parseInt(cursor, 10) : 0;
  const safeStart = Number.isFinite(start) && start >= 0 ? start : 0;
  const slice = items.slice(safeStart, safeStart + pageSize);
  const end = safeStart + slice.length;
  return {
    items: slice,
    ...(end < items.length ? { nextCursor: String(end) } : {}),
  };
}

/**
 * Async-search over tenant members. `query` is case-insensitive and matches
 * against user email, name, or id. Results are paginated with an opaque
 * offset cursor (string-encoded integer index).
 */
export async function searchActors(
  tenantId: string,
  query: string,
  cursor?: string,
): Promise<AsyncSearchPage<ActorCandidate>> {
  await simulateLatency('query');
  const state = useMockStore.getState();
  const memberships = Object.values(state.memberships).filter(
    (m) => m.tenant_id === tenantId && m.state === 'active',
  );
  const userIds = Array.from(new Set(memberships.map((m) => m.user_id)));
  const q = query.trim().toLowerCase();

  const candidates: ActorCandidate[] = [];
  for (const uid of userIds) {
    const user = state.users[uid];
    if (!user) continue;
    if (q) {
      const hay = `${user.email} ${user.name} ${user.id}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    candidates.push({
      handle: encodeActorHandle(user.id),
      label: `${user.name} <${user.email}>`,
    });
  }
  // Stable ordering so pagination is deterministic.
  candidates.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return sliceCursor(candidates, cursor, DEFAULT_PAGE_SIZE);
}

/**
 * Async-search over resource ids referenced by audit entries. Filters to
 * the requested `resourceType` and returns unique ids sorted lexically.
 * The `query` string is case-insensitive substring match on the resource id.
 */
export async function searchResourceIds(
  tenantId: string,
  resourceType: string,
  query: string,
  cursor?: string,
): Promise<AsyncSearchPage<ResourceIdCandidate>> {
  await simulateLatency('query');
  const state = useMockStore.getState();
  const q = query.trim().toLowerCase();

  const seen = new Set<string>();
  const candidates: ResourceIdCandidate[] = [];
  for (const entry of state.audit) {
    if (entry.tenant_id !== tenantId) continue;
    if (entry.resource_type !== resourceType) continue;
    if (!entry.resource_id) continue;
    const rid = entry.resource_id;
    if (seen.has(rid)) continue;
    seen.add(rid);
    if (q && !rid.toLowerCase().includes(q)) continue;
    candidates.push({
      handle: encodeResourceHandle(resourceType, rid),
      label: rid,
      resource_type: resourceType,
    });
  }
  candidates.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return sliceCursor(candidates, cursor, DEFAULT_PAGE_SIZE);
}

// ─── Retention config ────────────────────────────────────────────────────────

/** Read the retention config for a tenant. Returns `undefined` if none seeded. */
export function useRetentionConfig(tenantId: string): AuditRetentionConfig | undefined {
  return useMockStore((s) => s.auditRetentionConfigs[tenantId]);
}

/**
 * Persist an updated retention config for `tenantId`. Creates the row if
 * it does not exist, emits a host event + audit entry, and returns the
 * new config.
 */
export async function updateRetentionConfig(
  tenantId: string,
  input: UpdateRetentionConfigInput,
): Promise<AuditRetentionConfig> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();

  const next: AuditRetentionConfig = {
    tenant_id: tenantId,
    retention_days: { ...input.retention_days },
    auto_export: input.auto_export,
    auto_export_format: input.auto_export_format,
    updated_at: new Date().toISOString(),
  };

  const prev = state.auditRetentionConfigs[tenantId];
  useMockStore.setState((s) => ({
    auditRetentionConfigs: {
      ...s.auditRetentionConfigs,
      [tenantId]: next,
    },
  }));

  const entry: AuditEntry = {
    id: nextAuditId(),
    tenant_id: tenantId,
    actor_id: state.currentUserId ?? 'unknown',
    action: 'audit.retention.update',
    resource_type: 'audit-retention',
    resource_id: tenantId,
    outcome: 'success',
    at: next.updated_at,
    tier: 'write',
    diff: prev ? { before: prev, after: next } : { before: null, after: next },
  };
  state.appendAudit(entry);
  publishAudit(entry);

  emitHostEvent('audit.retention.updated', {
    tenant_id: tenantId,
  });

  return next;
}
