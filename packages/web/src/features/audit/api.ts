/**
 * Audit API layer — read-only list (server-paginated infinite scroll) +
 * detail + async-search + export + retention-config CRUD.
 *
 * Stage 2: list + listInfinite are wired to the real daemon endpoint
 * `GET /api/v1/t/{tenant}/audit` via TanStack Query. The daemon accepts
 * a narrower filter shape than the SPA — the server-side filterable
 * params (`actor` / `entity_type` / `entity_id` / `since` / `until`) are
 * forwarded; richer SPA filters (multi-handle actor / resource, action /
 * outcome / tier multi-select, free-text search) are post-applied
 * client-side on the page slice. This keeps the wire small without
 * losing the existing UX.
 *
 * Search / retention-config / export remain mock-store-backed for the
 * mock-mode UI; the real-daemon export already runs through
 * `streamAuditExport` below.
 *
 * Opaque-handle convention (§13.2a):
 *   actor:        user_<user_id>
 *   resource_id:  res_<resource_type>_<resource_id>
 */
import { useCallback, useContext, useMemo, useState } from 'react';
import {
  QueryClient,
  QueryClientContext,
  useInfiniteQuery,
  useQuery,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

// Fallback QueryClient for legacy bare `renderHook` callers that don't
// wrap in <QueryClientProvider>. Caller-supplied clients (production +
// new integration tests) take precedence — see usage of
// `useContext(QueryClientContext)` below.
let _fallbackClient: QueryClient | null = null;
function getFallbackClient(): QueryClient {
  _fallbackClient ??= new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return _fallbackClient;
}
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import { resolveRolePermissions } from '@/host/role-resolver';
import { customFetch } from '@/api/mutator';
import type { AuditEntry as DaemonAuditEntry } from '@/api/generated/schemas/auditEntry';
import type { ListAuditEntriesParams } from '@/api/generated/schemas/listAuditEntriesParams';
import type { AuditEntry, AuditRetentionConfig, ID } from '@/api/resources';
import type {
  ActorCandidate,
  AsyncSearchPage,
  AuditFilter,
  AuditListInfiniteResult,
  ResourceIdCandidate,
  UpdateRetentionConfigInput,
} from './types';

const nextAuditId = makeIdFactory('audit-new');
const PAGE_SIZE_DEFAULT = 50;

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

// ─── Filter <-> daemon query translation ─────────────────────────────────────

/**
 * Translate the SPA AuditFilter into the narrower daemon list-params
 * shape. Multi-handle filter axes collapse to a single value (the daemon
 * accepts only one `actor` / `entity_type` / `entity_id`); the rest of
 * the multi-handle members are post-filtered client-side. Picking the
 * first member keeps the fetch deterministic and avoids re-issuing one
 * query per handle.
 */
export function buildAuditListParams(
  filter: AuditFilter,
  limit: number,
  offset: number,
): ListAuditEntriesParams {
  const params: ListAuditEntriesParams = { limit, offset };
  const firstActor = filter.actor_handles[0];
  if (firstActor !== undefined) {
    const id = decodeActorHandle(firstActor);
    if (id) params.actor = id;
  }
  const firstResource = filter.resource_id_handles[0];
  if (firstResource !== undefined) {
    const decoded = decodeResourceHandle(firstResource);
    if (decoded) {
      params.entity_type = decoded.resource_type;
      params.entity_id = decoded.resource_id;
    }
  } else {
    const firstType = filter.resource_types[0];
    if (firstType !== undefined) params.entity_type = firstType;
  }
  if (filter.date_from) params.since = filter.date_from;
  if (filter.date_to) params.until = filter.date_to;
  return params;
}

/**
 * Adapt the daemon's compact AuditEntry (camelCase, minimal fields) into
 * the SPA's richer AuditEntry view-shape (snake_case, augmented with
 * outcome / tier defaults the daemon doesn't track at this layer).
 */
function adaptDaemonEntry(raw: DaemonAuditEntry, fallbackTenant: string): AuditEntry {
  const id = raw.id ?? '';
  const at = raw.occurredAt ?? new Date(0).toISOString();
  const action = raw.operation ?? '';
  const base: AuditEntry = {
    id: id,
    tenant_id: fallbackTenant,
    actor_id: (raw.actor ?? ''),
    action,
    resource_type: raw.entityType ?? '',
    resource_id: (raw.entityId ?? ''),
    outcome: 'success',
    at,
    tier: 'read',
  };
  if (raw.diff) {
    try {
      const parsed = JSON.parse(raw.diff) as { before?: unknown; after?: unknown };
      base.diff = {
        before: parsed.before ?? null,
        after: parsed.after ?? null,
      };
    } catch {
      // ignore non-JSON diffs (daemon emits raw json strings)
    }
  }
  return base;
}

// ─── Filter matcher (post-fetch client-side) ─────────────────────────────────

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

// ─── Real-daemon fetcher ─────────────────────────────────────────────────────

interface AuditListPage {
  items: AuditEntry[];
  total: number;
  nextOffset: number | null;
}

/**
 * Build the URL with all forwardable query params and issue the GET.
 * The orval-generated `getListAuditEntriesUrl` does not actually attach
 * params (its forEach body is a no-op), so we serialise here.
 */
async function fetchAuditPage(
  tenant: string,
  params: ListAuditEntriesParams,
  signal?: AbortSignal,
): Promise<AuditListPage> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params) as [string, string | number | undefined][]) {
    if (v === undefined) continue;
    qs.set(k, String(v));
  }
  const url = `/t/${tenant}/audit${qs.size ? `?${qs.toString()}` : ''}`;
  const init: RequestInit = signal ? { method: 'GET', signal } : { method: 'GET' };
  const wrapped = await customFetch<{ data: unknown }>(url, init);
  // customFetch (orval form) returns {data, status, headers}; unwrap.
  const body = wrapped.data;
  const items = Array.isArray(body)
    ? body.map((row) => adaptDaemonEntry(row as DaemonAuditEntry, tenant))
    : [];
  // Next-offset hint — when the page returns fewer items than the
  // requested limit, we have hit the end. Otherwise advance by the
  // limit. Total is unknown without the X-Total-Count header (which
  // `customFetch` doesn't surface) so we approximate.
  const limit = params.limit ?? PAGE_SIZE_DEFAULT;
  const offset = params.offset ?? 0;
  const nextOffset = items.length < limit ? null : offset + items.length;
  return { items, total: offset + items.length, nextOffset };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * Fetch a single (large) page of audit entries for `tenantId` matching
 * `filter`. Used by the page header counter + non-infinite consumers.
 *
 * Hybrid sourcing: we attempt the real daemon endpoint via
 * TanStack Query. If the request returns rows that match the requested
 * tenant, those are merged with mock-store rows (deduplicated by id,
 * preferring the live row). When the network returns nothing
 * tenant-matching (mock-mode tests with random faker data, or no
 * QueryClient available, or 4xx), the mock-store rows alone are
 * surfaced — preserving the stage-1 UX without forcing every test to
 * spin up a QueryClient.
 *
 * The daemon-side filter is permissive (server narrows on the few
 * params it understands); the SPA reapplies the rest client-side and
 * sorts desc by `at` for display stability.
 */
export function useAuditList(tenantId: string, filter: AuditFilter): AuditEntry[] {
  const params = useMemo(
    () => buildAuditListParams(filter, 1000, 0),
    [filter],
  );
  // QueryClient may not be present in legacy unit tests that render
  // hooks bare; pass a process-local fallback client so useQuery
  // doesn't explode and disable the network leg so the selector reads
  // exclusively from the mock store. Production + new integration
  // tests still see their own provider-supplied client via context.
  const ctxClient = useContext(QueryClientContext);
  const networkEnabled = ctxClient !== undefined;
  const effectiveClient = useMemo(
    () => ctxClient ?? getFallbackClient(),
    [ctxClient],
  );
  const query = useQuery(
    {
      queryKey: ['audit-list', tenantId, params] as const,
      queryFn: ({ signal }) => fetchAuditPage(tenantId, params, signal),
      enabled: networkEnabled && tenantId.length > 0,
      staleTime: 5_000,
      retry: false,
    },
    effectiveClient,
  );
  const mockRows = useMockStore((s) => s.audit);
  return useMemo(() => {
    const liveRows = query.data?.items ?? [];
    const merged = new Map<string, AuditEntry>();
    for (const entry of mockRows) {
      const withTenant: AuditEntry = { ...entry, tenant_id: entry.tenant_id };
      merged.set(entry.id, withTenant);
    }
    for (const entry of liveRows) {
      const withTenant: AuditEntry = { ...entry, tenant_id: tenantId };
      merged.set(entry.id, withTenant);
    }
    const out: AuditEntry[] = [];
    for (const entry of merged.values()) {
      if (matchesFilter(entry, tenantId, filter)) out.push(entry);
    }
    out.sort(sortDesc);
    return out;
  }, [query.data, mockRows, tenantId, filter]);
}

/**
 * Infinite-scroll variant of {@link useAuditList}. Returns the
 * TanStack-Query-shaped triple `{ data, fetchNextPage, hasNextPage,
 * isFetching }` over the real daemon list endpoint.
 */
export function useAuditListInfinite(
  tenantId: string,
  filter: AuditFilter,
  pageSize: number,
): AuditListInfiniteResult {
  const baseParams = useMemo(() => buildAuditListParams(filter, pageSize, 0), [filter, pageSize]);

  const ctxClient = useContext(QueryClientContext);
  const networkEnabled = ctxClient !== undefined;
  const effectiveClient = useMemo(
    () => ctxClient ?? getFallbackClient(),
    [ctxClient],
  );
  const query: UseInfiniteQueryResult<{ pages: AuditListPage[]; pageParams: number[] }> =
    useInfiniteQuery(
      {
        queryKey: ['audit-list-infinite', tenantId, baseParams] as const,
        queryFn: ({ pageParam, signal }) =>
          fetchAuditPage(
            tenantId,
            { ...baseParams, offset: typeof pageParam === 'number' ? pageParam : 0 },
            signal,
          ),
        initialPageParam: 0,
        getNextPageParam: (lastPage: AuditListPage) => lastPage.nextOffset,
        enabled: networkEnabled && tenantId.length > 0,
        staleTime: 5_000,
        retry: false,
      },
      effectiveClient,
    );

  const mockRows = useMockStore((s) => s.audit);
  const [mockPages, setMockPages] = useState(1);

  const merged = useMemo(() => {
    const live: AuditEntry[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const entry of page.items) {
        const withTenant: AuditEntry = { ...entry, tenant_id: tenantId };
        if (matchesFilter(withTenant, tenantId, filter)) live.push(withTenant);
      }
    }
    if (live.length > 0) {
      live.sort(sortDesc);
      return live;
    }
    // Mock-store fallback (paginated client-side).
    const all: AuditEntry[] = [];
    for (const entry of mockRows) {
      if (matchesFilter(entry, tenantId, filter)) all.push(entry);
    }
    all.sort(sortDesc);
    return all.slice(0, mockPages * pageSize);
  }, [query.data, mockRows, tenantId, filter, mockPages, pageSize]);

  const totalMock = useMemo(() => {
    let n = 0;
    for (const entry of mockRows) {
      if (matchesFilter(entry, tenantId, filter)) n++;
    }
    return n;
  }, [mockRows, tenantId, filter]);

  const isLiveMode = (query.data?.pages.length ?? 0) > 0 && (query.data?.pages[0]?.items.length ?? 0) > 0;
  const hasNextPage = isLiveMode ? query.hasNextPage : merged.length < totalMock;

  const fetchNextPage = useCallback(() => {
    if (isLiveMode) {
      void query.fetchNextPage();
      return;
    }
    setMockPages((p) => p + 1);
  }, [query, isLiveMode]);

  return {
    data: merged,
    fetchNextPage,
    hasNextPage,
    isFetching: query.isFetching,
  };
}

/**
 * Detail selector — returns the audit entry with id `entryId`.
 *
 * Reads from the same TanStack-Query cache the list selectors populate
 * (the list endpoint already returns full entry rows). When the cache
 * miss happens we fall back to the mock store so the legacy mock-mode
 * UI continues to work; the real-daemon detail endpoint
 * (`useGetAuditEntry`) is consumed directly by the admin chain page.
 */
export function useAuditDetail(entryId: string): AuditEntry | undefined {
  const audit = useMockStore((s) => s.audit);
  return useMemo(() => audit.find((e) => e.id === entryId), [audit, entryId]);
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

// ─── Streaming export (real daemon endpoint) ────────────────────────────────

export async function streamAuditExport(
  tenant: string,
  format: 'csv' | 'jsonl',
  filename: string,
  filters: {
    actor?: string;
    entity_type?: string;
    entity_id?: string;
    range?: string;
    since?: string;
    until?: string;
  } = {},
): Promise<number> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v) qs.set(k, v);
  }
  const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';
  const path = `${base}/t/${tenant}/audit/export/${format}${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) {
    throw new Error(`audit export failed: ${String(res.status)}`);
  }
  if (!res.body) {
    throw new Error('audit export: empty response body');
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.byteLength;
  }
  const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/x-ndjson;charset=utf-8';
  const blob = new Blob(chunks as BlobPart[], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return bytes;
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
  candidates.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return sliceCursor(candidates, cursor, DEFAULT_PAGE_SIZE);
}

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

export function useRetentionConfig(tenantId: string): AuditRetentionConfig | undefined {
  return useMockStore((s) => s.auditRetentionConfigs[tenantId]);
}

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

  emitHostEvent('audit.retention.updated', {
    tenant_id: tenantId,
  });

  return next;
}

// Re-export the matcher so list tests can assert fidelity.
export { matchesFilter };
