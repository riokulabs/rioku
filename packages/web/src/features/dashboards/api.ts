/**
 * Dashboards API — daemon-backed (Plan 16b, closes #235).
 *
 * Bridges the daemon DTO surface (camelCase, `mode: metabase|advanced`,
 * `scope: tenant|user`) to the SPA's existing snake_case `Dashboard`
 * resource shape (`mode: metabase|grafana`, `scope: personal|tenant|shared`).
 *
 * Mapping rules:
 *   - daemon `mode: 'advanced'`  ↔ SPA `mode: 'grafana'`
 *   - daemon `scope: 'user'`     ↔ SPA `scope: 'personal'`
 *   - daemon stores no `share_permission`/`role_grants`/`user_grants` —
 *     those fields are returned undefined (UI defaults to `read`).
 *   - daemon stores no SPA `layout` map; we synthesize it from each
 *     widget's `layout` field. SPA `widget_ids` is similarly built from
 *     the widget list ordered by (y, x).
 *
 * The hooks return synchronous arrays / single objects (with empty /
 * undefined fallbacks while the underlying TanStack Query is loading) to
 * preserve the contracts established by the stage-1 mock-store API. The
 * callers were written against that shape and continue to work without
 * changes.
 */
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';
import { emitHostEvent } from '@/host/events';
import type { Dashboard, DashboardVariable, DashboardVersion, Widget } from '@/api/resources';
import {
  createDashboardViaDaemon,
  deleteDashboardViaDaemon,
  exportDashboardViaDaemon,
  importDashboardViaDaemon,
  listDashboardsViaDaemon,
  listDashboardVersionsViaDaemon,
  patchDashboardViaDaemon,
  restoreDashboardVersionViaDaemon,
  setDashboardHomeViaDaemon,
  setDefaultDashboardViaDaemon,
  snapshotDashboardViaDaemon,
} from './daemon-api';
import type {
  DaemonDashboard,
  DashboardExport as DaemonDashboardExport,
  DashboardVersion as DaemonDashboardVersion,
} from './daemon-api';
import { dashboardExportSchema } from './schemas';
import { DASHBOARD_EXPORT_VERSION, DashboardImportError } from './types';
import type {
  CreateDashboardInput,
  DashboardExport,
  DashboardFilter,
  UpdateDashboardInput,
} from './types';

// ─── Query keys ───────────────────────────────────────────────────────────────

const dashboardsKey = (tenant: string) => ['dashboards', tenant] as const;
const dashboardKey = (tenant: string, id: string) => ['dashboard', tenant, id] as const;
const widgetsKey = (tenant: string, id: string) => ['dashboard', tenant, id, 'widgets'] as const;
const versionsKey = (tenant: string, id: string) => ['dashboard', tenant, id, 'versions'] as const;

// ─── Mode / scope mapping ─────────────────────────────────────────────────────

function daemonModeToSpa(m: string | undefined): 'metabase' | 'grafana' {
  return m === 'advanced' ? 'grafana' : 'metabase';
}
function spaModeToDaemon(m: 'metabase' | 'grafana' | undefined): 'metabase' | 'advanced' {
  return m === 'grafana' ? 'advanced' : 'metabase';
}
function daemonScopeToSpa(s: string | undefined): 'personal' | 'tenant' | 'shared' {
  if (s === 'user') return 'personal';
  return 'tenant';
}
function spaScopeToDaemon(s: 'personal' | 'tenant' | 'shared' | undefined): 'tenant' | 'user' {
  if (s === 'personal') return 'user';
  // 'shared' has no daemon equivalent — collapse to tenant; the access
  // grants are tracked separately via the share endpoint.
  return 'tenant';
}

// ─── Widget endpoints (raw fetch; no orval hook for these reads exists in api.ts) ─────

interface DaemonWidget {
  id: string;
  dashboardId: string;
  kind: string;
  title: string;
  dataSource: string;
  config: Record<string, unknown>;
  rawQuery?: string | null;
  lockedAdvanced: boolean;
  layout: { x: number; y: number; w: number; h: number };
  createdAt: string;
  updatedAt: string;
}

async function listWidgetsRaw(tenant: string, dashboardId: string): Promise<DaemonWidget[]> {
  // customFetch via the Orval positional path returns `{data, status, headers}`;
  // tests that mock customFetch (or shape-direct MSW handlers) may return
  // the body directly — handle both.
  const res: unknown = await customFetch(`/api/v1/t/${tenant}/dashboards/${dashboardId}/widgets`, {
    method: 'GET',
  });
  let body: unknown = res;
  if (res !== null && typeof res === 'object' && 'data' in res) {
    const r = res as { data: unknown };
    if (r.data !== undefined) body = r.data;
  }
  return (body as { items: DaemonWidget[] }).items;
}

// ─── Daemon → SPA mappers ────────────────────────────────────────────────────

function mapDaemonWidget(w: DaemonWidget): Widget {
  const variables = w.config;
  const widget: Widget = {
    id: w.id,
    dashboard_id: w.dashboardId,
    kind: w.kind,
    title: w.title,
    config: variables,
    position: { x: w.layout.x, y: w.layout.y, w: w.layout.w, h: w.layout.h },
    data_source: w.dataSource,
    raw_query: w.rawQuery ?? '',
    locked_advanced: w.lockedAdvanced,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
  };
  return widget;
}

function mapDaemonDashboard(d: DaemonDashboard, widgets: DaemonWidget[]): Dashboard {
  // Order widgets by (y, x) so widget_ids surface matches the visual flow.
  const sorted = [...widgets].sort((a, b) => {
    if (a.layout.y !== b.layout.y) return a.layout.y - b.layout.y;
    return a.layout.x - b.layout.x;
  });
  const widget_ids = sorted.map((w) => w.id);
  const layout: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const w of sorted) {
    layout[w.id] = { x: w.layout.x, y: w.layout.y, w: w.layout.w, h: w.layout.h };
  }
  const variables = (Array.isArray(d.variables)
    ? d.variables
    : []) as unknown as DashboardVariable[];
  return {
    id: d.id,
    tenant_id: d.tenantId,
    name: d.name,
    default: d.isDefault,
    widget_ids,
    description: d.description,
    owner_user_id: d.ownerUserId ?? null,
    mode: daemonModeToSpa(d.mode),
    scope: daemonScopeToSpa(d.scope),
    shared_role_ids: d.sharedRoleIds,
    layout,
    variables,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };
}

function mapDaemonVersion(v: DaemonDashboardVersion): DashboardVersion {
  // The daemon stores the snapshot as opaque JSON; decode best-effort.
  const snap = v.snapshot as unknown as {
    dashboard?: Partial<DaemonDashboard>;
    widgets?: DaemonWidget[];
  };
  const widgets = (snap.widgets ?? []).map(mapDaemonWidget);
  const dashboardSnap = snap.dashboard ?? {};
  const variables = (Array.isArray(dashboardSnap.variables)
    ? dashboardSnap.variables
    : []) as unknown as DashboardVariable[];
  return {
    id: v.id,
    dashboard_id: v.dashboardId,
    version: v.version,
    created_at: v.createdAt,
    created_by: v.createdBy ?? '',
    ...(v.note ? { description: v.note } : {}),
    snapshot: {
      dashboard: {
        name: dashboardSnap.name ?? '',
        default: dashboardSnap.isDefault ?? false,
        widget_ids: widgets.map((w) => w.id),
        ...(dashboardSnap.description !== undefined
          ? { description: dashboardSnap.description }
          : {}),
        owner_user_id: dashboardSnap.ownerUserId ?? null,
        mode: daemonModeToSpa(dashboardSnap.mode),
        scope: daemonScopeToSpa(dashboardSnap.scope),
        shared_role_ids: dashboardSnap.sharedRoleIds ?? [],
        layout: widgets.reduce<Record<string, { x: number; y: number; w: number; h: number }>>(
          (acc, w) => {
            acc[w.id] = w.position;
            return acc;
          },
          {},
        ),
        variables,
      },
      widgets: widgets.map((w) => ({
        id: w.id,
        kind: w.kind,
        title: w.title,
        config: w.config,
        position: w.position,
        data_source: w.data_source,
        raw_query: w.raw_query,
        locked_advanced: w.locked_advanced,
      })),
    },
  };
}

// ─── Tenant resolution helper ────────────────────────────────────────────────
//
// All hooks/mutations expect a tenant *slug*. The daemon paths are slug-
// scoped. When callers pass an empty string we early-return empty data
// (covers the boot-time race during admin-tenant lookup).

// ─── Selectors ───────────────────────────────────────────────────────────────

/**
 * Returns the dashboards visible to the active tenant, optionally filtered
 * by the SPA filter shape. Filtering is performed client-side because the
 * daemon list endpoint does not expose query params for these facets.
 */
export function useDashboardList(tenant: string, filter: DashboardFilter): Dashboard[] {
  const enabled = tenant.length > 0;
  const { data: dashboards } = useQuery({
    queryKey: dashboardsKey(tenant),
    queryFn: () => listDashboardsViaDaemon(tenant),
    enabled,
  });

  // Fetch widget lists in a single batch query so layout / widget_ids are
  // populated for the list view.
  const ids = useMemo(() => (dashboards?.items ?? []).map((d) => d.id), [dashboards]);
  const idKey = useMemo(() => ids.join(','), [ids]);
  const { data: widgetMap } = useQuery({
    queryKey: ['dashboards', tenant, 'widgets-bulk', idKey],
    queryFn: async () => {
      const map: Record<string, DaemonWidget[]> = {};
      await Promise.all(
        ids.map(async (id) => {
          map[id] = await listWidgetsRaw(tenant, id);
        }),
      );
      return map;
    },
    enabled: enabled && ids.length > 0,
  });

  return useMemo(() => {
    if (!dashboards) return [];
    const search = filter.search.toLowerCase().trim();
    const out: Dashboard[] = [];
    for (const d of dashboards.items) {
      const widgets = widgetMap?.[d.id] ?? [];
      const mapped = mapDaemonDashboard(d, widgets);
      if (filter.modes.length > 0 && !filter.modes.includes(mapped.mode)) continue;
      if (filter.scopes.length > 0 && !filter.scopes.includes(mapped.scope)) continue;
      if (filter.defaultOnly === true && !mapped.default) continue;
      if (search) {
        const nameMatch = mapped.name.toLowerCase().includes(search);
        const descMatch = mapped.description?.toLowerCase().includes(search) ?? false;
        if (!nameMatch && !descMatch) continue;
      }
      out.push(mapped);
    }
    return out;
  }, [dashboards, widgetMap, filter.search, filter.modes, filter.scopes, filter.defaultOnly]);
}

function useTenantSlugForDashboard(dashboardId: string): string {
  const queryClient = useQueryClient();
  const cached = queryClient.getQueriesData<{ items: DaemonDashboard[] }>({
    queryKey: ['dashboards'],
  });
  for (const [key, value] of cached) {
    if (!value || !Array.isArray((value as { items?: unknown[] }).items)) continue;
    const list = (value as { items: DaemonDashboard[] }).items;
    if (list.some((d) => d.id === dashboardId)) {
      const slug = key[1];
      if (typeof slug === 'string') return slug;
    }
  }
  return '';
}

function useDaemonWidgets(tenant: string, dashboardId: string): DaemonWidget[] {
  const { data } = useQuery({
    queryKey: widgetsKey(tenant, dashboardId),
    queryFn: () => listWidgetsRaw(tenant, dashboardId),
    enabled: tenant.length > 0 && dashboardId.length > 0,
  });
  return data ?? [];
}

export function useDashboardDetail(id: string): Dashboard | undefined {
  const tenantSlug = useTenantSlugForDashboard(id);
  const daemonWidgets = useDaemonWidgets(tenantSlug, id);
  const queryClient = useQueryClient();

  return useMemo(() => {
    const cached = queryClient.getQueriesData<{ items: DaemonDashboard[] }>({
      queryKey: ['dashboards'],
    });
    for (const [, value] of cached) {
      if (!value || !Array.isArray((value as { items?: unknown[] }).items)) continue;
      const list = (value as { items: DaemonDashboard[] }).items;
      const match = list.find((d) => d.id === id);
      if (match) return mapDaemonDashboard(match, daemonWidgets);
    }
    return undefined;
  }, [queryClient, id, daemonWidgets]);
}

/**
 * Returns the widgets attached to a dashboard, mapped into the SPA
 * `Widget` shape. Tenant slug is resolved from any cached dashboard list
 * (the routes fetch the list at the page level so this is always
 * available before the detail page mounts).
 */
export function useDashboardWidgets(dashboardId: string): Widget[] {
  const tenantSlug = useTenantSlugForDashboard(dashboardId);
  const daemonWidgets = useDaemonWidgets(tenantSlug, dashboardId);
  return useMemo(() => daemonWidgets.map(mapDaemonWidget), [daemonWidgets]);
}

export function useDashboardVersions(dashboardId: string): DashboardVersion[] {
  const tenantSlug = useTenantSlugForDashboard(dashboardId);
  const { data } = useQuery({
    queryKey: versionsKey(tenantSlug, dashboardId),
    queryFn: () => listDashboardVersionsViaDaemon(tenantSlug, dashboardId),
    enabled: tenantSlug.length > 0 && dashboardId.length > 0,
  });
  return useMemo(() => {
    const items = data?.items ?? [];
    return items.map(mapDaemonVersion).sort((a, b) => b.version - a.version);
  }, [data]);
}

/**
 * Per-user "my home" override. The daemon stores this as `homeForUsers[]`
 * on each dashboard row, so we resolve by walking the cached list. When
 * no cached list exists yet we return `undefined` and let the caller
 * re-render once the list query completes.
 */
export function useUserHomeDashboard(userId: string): string | undefined {
  const queryClient = useQueryClient();
  if (!userId) return undefined;
  const cached = queryClient.getQueriesData<{ items: DaemonDashboard[] }>({
    queryKey: ['dashboards'],
  });
  for (const [, value] of cached) {
    if (!value || !Array.isArray((value as { items?: unknown[] }).items)) continue;
    const list = (value as { items: DaemonDashboard[] }).items;
    for (const d of list) {
      if (d.homeForUsers.includes(userId)) return d.id;
    }
  }
  return undefined;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createDashboard(
  tenant: string,
  input: CreateDashboardInput,
): Promise<Dashboard> {
  const created = await createDashboardViaDaemon(tenant, {
    name: input.name,
    ...(input.description !== undefined ? { description: input.description } : {}),
    mode: spaModeToDaemon(input.mode),
    scope: spaScopeToDaemon(input.scope),
    sharedRoleIds: input.shared_role_ids ?? [],
    variables: (input.variables ?? []) as unknown as Record<string, unknown>[],
  });
  emitHostEvent('dashboard.created', { dashboard_id: created.id, tenant_id: created.tenantId });
  return mapDaemonDashboard(created, []);
}

export async function updateDashboard(id: string, input: UpdateDashboardInput): Promise<Dashboard> {
  // We need the tenant slug; resolve via any cached list.
  const tenant = resolveCachedTenantSlug(id);
  if (!tenant) throw new Error(`Dashboard ${id} tenant not resolved`);

  const body: {
    name?: string;
    description?: string;
    mode?: string;
    scope?: string;
    sharedRoleIds?: string[];
    variables?: Record<string, unknown>[];
  } = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.description !== undefined) body.description = input.description;
  if (input.mode !== undefined) body.mode = spaModeToDaemon(input.mode);
  if (input.scope !== undefined) body.scope = spaScopeToDaemon(input.scope);
  if (input.shared_role_ids !== undefined) body.sharedRoleIds = input.shared_role_ids;
  if (input.variables !== undefined) {
    body.variables = input.variables as unknown as Record<string, unknown>[];
  }

  // Layout / widget_ids / share_permission / role_grants / user_grants /
  // default_range live on SPA-only state — drop them silently. The
  // dashboard-builder owns the per-widget layout updates via the layout
  // endpoint and the share modal posts grants via the share endpoint.

  const updated = await patchDashboardViaDaemon(tenant, id, body);
  emitHostEvent('dashboard.updated', { dashboard_id: id, tenant_id: updated.tenantId });
  // After a write, re-fetch widgets so the mapped Dashboard has fresh
  // layout state.
  const widgets = await listWidgetsRaw(tenant, id);
  return mapDaemonDashboard(updated, widgets);
}

export async function deleteDashboard(id: string): Promise<void> {
  const tenant = resolveCachedTenantSlug(id);
  if (!tenant) throw new Error(`Dashboard ${id} tenant not resolved`);
  await deleteDashboardViaDaemon(tenant, id);
  emitHostEvent('dashboard.deleted', { dashboard_id: id });
}

export async function setDefaultDashboard(tenant: string, dashboardId: string): Promise<Dashboard> {
  const updated = await setDefaultDashboardViaDaemon(tenant, dashboardId);
  emitHostEvent('dashboard.default-changed', { dashboard_id: dashboardId, tenant_id: tenant });
  const widgets = await listWidgetsRaw(tenant, dashboardId);
  return mapDaemonDashboard(updated, widgets);
}

/**
 * Set a dashboard as the calling user's personal home. The daemon reads
 * the user id from the session cookie, so the `userId` arg here is
 * preserved only for the audit / event payload.
 */
export async function setAsMyHome(userId: string, dashboardId: string): Promise<void> {
  const tenant = resolveCachedTenantSlug(dashboardId);
  if (!tenant) throw new Error(`Dashboard ${dashboardId} tenant not resolved`);
  await setDashboardHomeViaDaemon(tenant, dashboardId);
  emitHostEvent('dashboard.home-changed', { user_id: userId, dashboard_id: dashboardId });
}

export async function snapshotDashboard(
  dashboardId: string,
  description?: string,
): Promise<DashboardVersion> {
  const tenant = resolveCachedTenantSlug(dashboardId);
  if (!tenant) throw new Error(`Dashboard ${dashboardId} tenant not resolved`);
  const v = await snapshotDashboardViaDaemon(tenant, dashboardId, {
    ...(description !== undefined ? { note: description } : {}),
  });
  emitHostEvent('dashboard.snapshot', { dashboard_id: dashboardId, version: v.version });
  return mapDaemonVersion(v);
}

export async function restoreDashboardVersion(versionId: string): Promise<Dashboard> {
  // Restoring requires the tenant slug; we walk the cached versions
  // queries to find which one contains this version id.
  // The version queryKey is ['dashboard', tenant, dashboardId, 'versions'].
  const found = findCachedVersion(versionId);
  if (!found) throw new Error(`Version ${versionId} tenant not resolved`);
  const restored = await restoreDashboardVersionViaDaemon(found.tenant, versionId);
  emitHostEvent('dashboard.restored', {
    dashboard_id: restored.id,
    from_version_id: versionId,
  });
  const widgets = await listWidgetsRaw(found.tenant, restored.id);
  return mapDaemonDashboard(restored, widgets);
}

// ─── JSON export / import ─────────────────────────────────────────────────────

/**
 * Build the exportable JSON payload for a dashboard. This currently still
 * synthesizes from cache because the export endpoint is async; for an
 * "actual server export" use `exportDashboardServerSide` below.
 */
export function exportDashboardJson(id: string): DashboardExport {
  const tenant = resolveCachedTenantSlug(id);
  // We do best-effort sync export from the cache; if it isn't loaded yet
  // throw so the caller surfaces the failure (matches stage-1 behaviour).
  if (!tenant) throw new Error(`Dashboard ${id} not found`);
  const cachedDashboard = findCachedDashboard(id);
  if (!cachedDashboard) throw new Error(`Dashboard ${id} not found`);
  // Widgets aren't always cached synchronously; return an empty list when
  // they aren't and let the server-side export do the heavy lift.
  const cachedWidgets = findCachedWidgets(tenant, id) ?? [];
  const dashboard = mapDaemonDashboard(cachedDashboard, cachedWidgets);
  const widgets = cachedWidgets.map(mapDaemonWidget);
  return {
    version: DASHBOARD_EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    dashboard,
    widgets,
  };
}

/** Server-side export (canonical). Fetches the JSON payload over the wire. */
export async function exportDashboardServerSide(
  tenant: string,
  id: string,
): Promise<DaemonDashboardExport> {
  return exportDashboardViaDaemon(tenant, id);
}

export async function importDashboardJson(
  tenant: string,
  json: string | DashboardExport,
): Promise<Dashboard> {
  let rawParsed: unknown;
  if (typeof json === 'string') {
    try {
      rawParsed = JSON.parse(json) as unknown;
    } catch (e) {
      throw new DashboardImportError(`Invalid JSON: ${(e as Error).message}`);
    }
  } else {
    rawParsed = json;
  }
  const parsed = dashboardExportSchema.safeParse(rawParsed);
  if (!parsed.success) {
    throw new DashboardImportError(`Invalid dashboard export: ${parsed.error.message}`);
  }
  // Build the daemon-shaped export payload. The daemon import handler
  // recreates ids server-side so we strip ours.
  const dash = parsed.data.dashboard;
  const widgets = parsed.data.widgets;
  const daemonExport: DaemonDashboardExport = {
    dashboard: {
      id: dash.id,
      tenantId: dash.tenant_id,
      name: dash.name,
      description: dash.description ?? '',
      mode: spaModeToDaemon(dash.mode),
      scope: spaScopeToDaemon(dash.scope),
      isDefault: false,
      ownerUserId: dash.owner_user_id ?? null,
      sharedRoleIds: dash.shared_role_ids,
      homeForUsers: [],
      variables: dash.variables as unknown as Record<string, unknown>[],
      createdAt: dash.created_at,
      updatedAt: dash.updated_at,
    },
    widgets: widgets.map((w) => ({
      id: w.id,
      dashboardId: w.dashboard_id,
      kind: w.kind,
      title: w.title,
      dataSource: w.data_source,
      config: w.config,
      rawQuery: w.raw_query || null,
      lockedAdvanced: w.locked_advanced,
      layout: w.position,
      createdAt: w.created_at,
      updatedAt: w.updated_at,
    })) as DaemonDashboardExport['widgets'],
  };
  const created = await importDashboardViaDaemon(tenant, daemonExport);
  emitHostEvent('dashboard.imported', { dashboard_id: created.id, tenant_id: tenant });
  return mapDaemonDashboard(created, []);
}

// ─── Cache walkers ────────────────────────────────────────────────────────────
//
// These read directly from the QueryClient via the singleton accessor that
// the SPA installs at app boot (`@/api/query-client`). Keeping them inside
// this module avoids leaking the QC context across the feature boundary.

import { queryClient as appQueryClient } from '@/api/query-client';

function resolveCachedTenantSlug(dashboardId: string): string | undefined {
  const qc = appQueryClient;
  const cached = qc.getQueriesData<{ items: DaemonDashboard[] }>({ queryKey: ['dashboards'] });
  for (const [key, value] of cached) {
    if (!value || !Array.isArray((value as { items?: unknown[] }).items)) continue;
    const list = (value as { items: DaemonDashboard[] }).items;
    if (list.some((d) => d.id === dashboardId)) {
      const slug = key[1];
      if (typeof slug === 'string') return slug;
    }
  }
  return undefined;
}

function findCachedDashboard(id: string): DaemonDashboard | undefined {
  const qc = appQueryClient;
  const cached = qc.getQueriesData<{ items: DaemonDashboard[] }>({ queryKey: ['dashboards'] });
  for (const [, value] of cached) {
    if (!value || !Array.isArray((value as { items?: unknown[] }).items)) continue;
    const list = (value as { items: DaemonDashboard[] }).items;
    const found = list.find((d) => d.id === id);
    if (found) return found;
  }
  return undefined;
}

function findCachedWidgets(tenant: string, dashboardId: string): DaemonWidget[] | undefined {
  const qc = appQueryClient;
  return qc.getQueryData<DaemonWidget[]>(widgetsKey(tenant, dashboardId));
}

function findCachedVersion(versionId: string): { tenant: string; dashboardId: string } | undefined {
  const qc = appQueryClient;
  const cached = qc.getQueriesData<{ items: DaemonDashboardVersion[] }>({
    queryKey: ['dashboard'],
  });
  for (const [key, value] of cached) {
    if (!value || !Array.isArray((value as { items?: unknown[] }).items)) continue;
    const arr = key;
    if (arr[3] !== 'versions') continue;
    const items = (value as { items: DaemonDashboardVersion[] }).items;
    if (items.some((v) => v.id === versionId)) {
      const tenant = arr[1];
      const dashboardId = arr[2];
      if (typeof tenant === 'string' && typeof dashboardId === 'string') {
        return { tenant, dashboardId };
      }
    }
  }
  return undefined;
}

// ─── Mutation hook helpers (TanStack Query) ──────────────────────────────────
//
// Exposed for components that prefer the hook-based mutation API.

export function useCreateDashboardMutation(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDashboardInput) => createDashboard(tenant, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardsKey(tenant) });
    },
  });
}

export function useUpdateDashboardMutation(tenant: string, dashboardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDashboardInput) => updateDashboard(dashboardId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardsKey(tenant) });
      void qc.invalidateQueries({ queryKey: dashboardKey(tenant, dashboardId) });
    },
  });
}

export function useDeleteDashboardMutation(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDashboard(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardsKey(tenant) });
    },
  });
}
