/**
 * Dashboards API — backed by the Zustand mock store.
 *
 * Exports CRUD for dashboards + widget lookup, version snapshot/restore,
 * default / home assignment, and JSON export/import. Every mutation logs an
 * audit entry and emits a host event.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { AuditEntry, Dashboard, DashboardVersion, Widget } from '@/api/resources';
import { dashboardExportSchema } from './schemas';
import { DASHBOARD_EXPORT_VERSION, DashboardImportError } from './types';
import type {
  CreateDashboardInput,
  DashboardExport,
  DashboardFilter,
  UpdateDashboardInput,
} from './types';

const nextDashboardId = makeIdFactory('dashboard-new');
const nextWidgetId = makeIdFactory('widget-new');
const nextVersionId = makeIdFactory('dashver-new');
const nextAuditId = makeIdFactory('audit-dash');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function getCurrentActorId(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

/** Strip mutable / relational fields from a dashboard for snapshot embedding. */
function dashboardSnapshotOf(d: Dashboard): DashboardVersion['snapshot']['dashboard'] {
  return {
    name: d.name,
    default: d.default,
    widget_ids: [...d.widget_ids],
    ...(d.description !== undefined ? { description: d.description } : {}),
    owner_user_id: d.owner_user_id,
    mode: d.mode,
    scope: d.scope,
    shared_role_ids: [...d.shared_role_ids],
    layout: { ...d.layout },
    variables: [...d.variables],
  };
}

/** Strip mutable / relational fields from a widget for snapshot embedding. */
function widgetSnapshotOf(w: Widget): DashboardVersion['snapshot']['widgets'][number] {
  return {
    id: w.id,
    kind: w.kind,
    title: w.title,
    config: w.config,
    position: w.position,
    data_source: w.data_source,
    raw_query: w.raw_query,
    ...(w.wizard_state !== undefined ? { wizard_state: w.wizard_state } : {}),
    locked_advanced: w.locked_advanced,
  };
}

function makeAuditEntry(
  actorId: string,
  tenantId: string | null,
  action: string,
  resourceId?: string,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  return {
    id: nextAuditId(),
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    resource_type: 'dashboard',
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier,
  };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useDashboardList(tenantId: string, filter: DashboardFilter): Dashboard[] {
  const dashboards = useMockStore((s) => s.dashboards);

  const search = filter.search.toLowerCase().trim();
  const results: Dashboard[] = [];
  for (const d of Object.values(dashboards)) {
    if (d.tenant_id !== tenantId) continue;
    if (filter.modes.length > 0 && !filter.modes.includes(d.mode)) continue;
    if (filter.scopes.length > 0 && !filter.scopes.includes(d.scope)) continue;
    if (filter.defaultOnly === true && !d.default) continue;
    if (search) {
      const nameMatch = d.name.toLowerCase().includes(search);
      const descMatch = d.description?.toLowerCase().includes(search) ?? false;
      if (!nameMatch && !descMatch) continue;
    }
    results.push(d);
  }
  return results;
}

export function useDashboardDetail(id: string): Dashboard | undefined {
  return useMockStore((s) => s.dashboards[id]);
}

/** Return the widgets referenced by a dashboard's `widget_ids`, preserving order. */
export function useDashboardWidgets(dashboardId: string): Widget[] {
  const dashboard = useMockStore((s) => s.dashboards[dashboardId]);
  const widgets = useMockStore((s) => s.widgets);
  if (!dashboard) return [];
  const out: Widget[] = [];
  for (const wid of dashboard.widget_ids) {
    const w = widgets[wid];
    if (w) out.push(w);
  }
  return out;
}

export function useDashboardVersions(dashboardId: string): DashboardVersion[] {
  const versions = useMockStore((s) => s.dashboardVersions);
  const out: DashboardVersion[] = [];
  for (const v of Object.values(versions)) {
    if (v.dashboard_id === dashboardId) out.push(v);
  }
  out.sort((a, b) => b.version - a.version);
  return out;
}

/** Reads the user's home-dashboard override, if any. */
export function useUserHomeDashboard(userId: string): string | undefined {
  return useMockStore((s) => s.userHomeDashboards[userId]);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createDashboard(
  tenantId: string,
  input: CreateDashboardInput,
): Promise<Dashboard> {
  await simulateLatency('mutation');
  const id = nextDashboardId();
  const dashboard: Dashboard = {
    id,
    tenant_id: tenantId,
    name: input.name,
    default: false,
    widget_ids: [],
    ...(input.description !== undefined ? { description: input.description } : {}),
    owner_user_id: input.owner_user_id ?? null,
    mode: input.mode ?? 'metabase',
    scope: input.scope ?? 'tenant',
    shared_role_ids: input.shared_role_ids ?? [],
    layout: {},
    variables: input.variables ?? [],
    created_at: now(),
    updated_at: now(),
  };
  const state = useMockStore.getState();
  state.addEntity('dashboards', dashboard);
  state.appendAudit(makeAuditEntry(getCurrentActorId(), tenantId, 'dashboard.create', id));
  emitHostEvent('dashboard.created', { dashboard_id: id, tenant_id: tenantId });
  return dashboard;
}

export async function updateDashboard(id: string, input: UpdateDashboardInput): Promise<Dashboard> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.dashboards[id];
  if (!current) throw new Error(`Dashboard ${id} not found`);

  const patch: Partial<Dashboard> = { updated_at: now() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.mode !== undefined) patch.mode = input.mode;
  if (input.scope !== undefined) patch.scope = input.scope;
  if (input.owner_user_id !== undefined) patch.owner_user_id = input.owner_user_id;
  if (input.shared_role_ids !== undefined) patch.shared_role_ids = input.shared_role_ids;
  if (input.variables !== undefined) patch.variables = input.variables;
  if (input.layout !== undefined) patch.layout = input.layout;
  if (input.widget_ids !== undefined) patch.widget_ids = input.widget_ids;
  if (input.default_range !== undefined) patch.default_range = input.default_range;

  state.updateEntity('dashboards', id, patch);
  const updated = useMockStore.getState().dashboards[id];
  if (!updated) throw new Error(`Dashboard ${id} vanished mid-update`);
  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), current.tenant_id, 'dashboard.update', id),
    diff: { before: current, after: updated },
  });
  emitHostEvent('dashboard.updated', { dashboard_id: id, tenant_id: current.tenant_id });
  return updated;
}

export async function deleteDashboard(id: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const dashboard = state.dashboards[id];
  if (!dashboard) throw new Error(`Dashboard ${id} not found`);

  // Remove owned widgets + versions atomically.
  useMockStore.setState((s) => {
    const nextDashboards = { ...s.dashboards };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete nextDashboards[id];
    const nextWidgets = { ...s.widgets };
    for (const wid of dashboard.widget_ids) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete nextWidgets[wid];
    }
    const nextVersions = { ...s.dashboardVersions };
    for (const [vid, v] of Object.entries(nextVersions)) {
      if (v.dashboard_id === id) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete nextVersions[vid];
      }
    }
    return {
      dashboards: nextDashboards,
      widgets: nextWidgets,
      dashboardVersions: nextVersions,
    };
  });
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), dashboard.tenant_id, 'dashboard.delete', id, 'destructive'),
  );
  emitHostEvent('dashboard.deleted', { dashboard_id: id, tenant_id: dashboard.tenant_id });
}

/** Atomic: flip `default` true on target, false on any prior default for the same tenant. */
export async function setDefaultDashboard(
  tenantId: string,
  dashboardId: string,
): Promise<Dashboard> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const target = state.dashboards[dashboardId];
  if (!target) throw new Error(`Dashboard ${dashboardId} not found`);
  if (target.tenant_id !== tenantId) throw new Error('Dashboard does not belong to tenant');

  useMockStore.setState((s) => {
    const nextDashboards: Record<string, Dashboard> = { ...s.dashboards };
    for (const [id, d] of Object.entries(nextDashboards)) {
      if (d.tenant_id !== tenantId) continue;
      if (id === dashboardId) {
        nextDashboards[id] = { ...d, default: true, updated_at: now() };
      } else if (d.default) {
        nextDashboards[id] = { ...d, default: false, updated_at: now() };
      }
    }
    return { dashboards: nextDashboards };
  });
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), tenantId, 'dashboard.set-default', dashboardId),
  );
  emitHostEvent('dashboard.default-changed', { dashboard_id: dashboardId, tenant_id: tenantId });
  const after = useMockStore.getState().dashboards[dashboardId];
  if (!after) throw new Error('Dashboard vanished');
  return after;
}

/** Write a per-user "my home" dashboard override. */
export async function setAsMyHome(userId: string, dashboardId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const dashboard = state.dashboards[dashboardId];
  if (!dashboard) throw new Error(`Dashboard ${dashboardId} not found`);

  useMockStore.setState((s) => ({
    userHomeDashboards: { ...s.userHomeDashboards, [userId]: dashboardId },
  }));
  state.appendAudit(
    makeAuditEntry(userId, dashboard.tenant_id, 'dashboard.set-as-my-home', dashboardId),
  );
  emitHostEvent('dashboard.home-changed', { user_id: userId, dashboard_id: dashboardId });
}

/** Create a new DashboardVersion capturing the current dashboard + its widgets. */
export async function snapshotDashboard(
  dashboardId: string,
  description?: string,
): Promise<DashboardVersion> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const dashboard = state.dashboards[dashboardId];
  if (!dashboard) throw new Error(`Dashboard ${dashboardId} not found`);

  const existing = Object.values(state.dashboardVersions).filter(
    (v) => v.dashboard_id === dashboardId,
  );
  const nextVersion = existing.reduce((m, v) => (v.version > m ? v.version : m), 0) + 1;

  const widgetSnapshots: DashboardVersion['snapshot']['widgets'] = [];
  for (const wid of dashboard.widget_ids) {
    const w = state.widgets[wid];
    if (!w) continue;
    widgetSnapshots.push(widgetSnapshotOf(w));
  }
  const dashRest = dashboardSnapshotOf(dashboard);

  const version: DashboardVersion = {
    id: nextVersionId(),
    dashboard_id: dashboardId,
    version: nextVersion,
    created_at: now(),
    created_by: getCurrentActorId(),
    ...(description !== undefined ? { description } : {}),
    snapshot: { dashboard: dashRest, widgets: widgetSnapshots },
  };
  useMockStore.setState((s) => ({
    dashboardVersions: { ...s.dashboardVersions, [version.id]: version },
    dashboards: {
      ...s.dashboards,
      [dashboardId]: { ...dashboard, updated_at: now() },
    },
  }));
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), dashboard.tenant_id, 'dashboard.snapshot', dashboardId),
  );
  emitHostEvent('dashboard.snapshot', { dashboard_id: dashboardId, version: nextVersion });
  return version;
}

/**
 * Replace the dashboard + its widgets with a captured snapshot, then record
 * a new version entry marking the restore.
 */
export async function restoreDashboardVersion(versionId: string): Promise<Dashboard> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const version = state.dashboardVersions[versionId];
  if (!version) throw new Error(`Dashboard version ${versionId} not found`);
  const current = state.dashboards[version.dashboard_id];
  if (!current) throw new Error(`Dashboard ${version.dashboard_id} not found`);

  useMockStore.setState((s) => {
    const nextWidgets = { ...s.widgets };
    // Remove current widgets
    for (const wid of current.widget_ids) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete nextWidgets[wid];
    }
    // Materialise snapshot widgets
    for (const snap of version.snapshot.widgets) {
      nextWidgets[snap.id] = {
        ...snap,
        dashboard_id: version.dashboard_id,
        created_at: current.created_at,
        updated_at: now(),
      };
    }
    const restored: Dashboard = {
      ...current,
      ...version.snapshot.dashboard,
      id: current.id,
      tenant_id: current.tenant_id,
      created_at: current.created_at,
      updated_at: now(),
    };
    return {
      widgets: nextWidgets,
      dashboards: { ...s.dashboards, [version.dashboard_id]: restored },
    };
  });

  // Write a new version entry marking the restore so history records both
  // the snapshot and the restore action.
  const marker: DashboardVersion = {
    id: nextVersionId(),
    dashboard_id: version.dashboard_id,
    version:
      Object.values(state.dashboardVersions)
        .filter((v) => v.dashboard_id === version.dashboard_id)
        .reduce((m, v) => (v.version > m ? v.version : m), 0) + 1,
    created_at: now(),
    created_by: getCurrentActorId(),
    description: `Restored from v${String(version.version)}`,
    snapshot: version.snapshot,
  };
  useMockStore.setState((s) => ({
    dashboardVersions: { ...s.dashboardVersions, [marker.id]: marker },
  }));

  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      current.tenant_id,
      'dashboard.restore',
      version.dashboard_id,
    ),
  );
  emitHostEvent('dashboard.restored', {
    dashboard_id: version.dashboard_id,
    from_version: version.version,
  });
  const after = useMockStore.getState().dashboards[version.dashboard_id];
  if (!after) throw new Error('Dashboard vanished');
  return after;
}

// ─── JSON export / import ─────────────────────────────────────────────────────

/** Build the exportable JSON payload for a dashboard. */
export function exportDashboardJson(id: string): DashboardExport {
  const state = useMockStore.getState();
  const dashboard = state.dashboards[id];
  if (!dashboard) throw new Error(`Dashboard ${id} not found`);
  const widgets: Widget[] = [];
  for (const wid of dashboard.widget_ids) {
    const w = state.widgets[wid];
    if (w) widgets.push(w);
  }
  return {
    version: DASHBOARD_EXPORT_VERSION,
    exported_at: now(),
    dashboard,
    widgets,
  };
}

/**
 * Parse + validate a JSON export payload and create a fresh dashboard (new
 * dashboard id + fresh widget ids). Audit + host event fire on success.
 */
export async function importDashboardJson(
  tenantId: string,
  json: string | DashboardExport,
): Promise<Dashboard> {
  await simulateLatency('mutation');

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
  // The schema pins the version literal to DASHBOARD_EXPORT_VERSION — any
  // mismatch surfaces as a safeParse failure above.

  const dashId = nextDashboardId();
  const idRemap = new Map<string, string>();
  const newWidgets: Widget[] = [];
  for (const w of parsed.data.widgets) {
    const newId = nextWidgetId();
    idRemap.set(w.id, newId);
    newWidgets.push({
      ...(w as Widget),
      id: newId,
      dashboard_id: dashId,
      created_at: now(),
      updated_at: now(),
    });
  }

  const oldDash = parsed.data.dashboard;
  const newLayout: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const [oldId, pos] of Object.entries(oldDash.layout)) {
    const newId = idRemap.get(oldId);
    if (newId) newLayout[newId] = pos;
  }

  const dashboard: Dashboard = {
    ...(oldDash as Dashboard),
    id: dashId,
    tenant_id: tenantId,
    default: false,
    widget_ids: newWidgets.map((w) => w.id),
    layout: newLayout,
    created_at: now(),
    updated_at: now(),
  };

  useMockStore.setState((s) => {
    const widgetMap = { ...s.widgets };
    for (const w of newWidgets) widgetMap[w.id] = w;
    return {
      dashboards: { ...s.dashboards, [dashId]: dashboard },
      widgets: widgetMap,
    };
  });

  const state = useMockStore.getState();
  state.appendAudit(makeAuditEntry(getCurrentActorId(), tenantId, 'dashboard.import', dashId));
  emitHostEvent('dashboard.imported', { dashboard_id: dashId, tenant_id: tenantId });
  return dashboard;
}
