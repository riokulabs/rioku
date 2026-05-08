/**
 * Daemon-backed dashboards API (stage-2, Plan 08 T2/T5).
 *
 * Thin wrappers around the generated orval clients in
 * `src/api/generated/dashboards/`. These are the entry points used when
 * `VITE_USE_MOCKS=false` flips the SPA into real-fetch mode. They live
 * alongside the existing mock-store-backed `api.ts` and consume the
 * daemon's wire-format DTOs (camelCase, snake-case-free) directly — see
 * `packages/proto/openapi-fragments/dashboards.yaml` for the schema and
 * `packages/daemon/internal/gateway/dashboards_routes.go` for the
 * server side.
 *
 * Mapping rules:
 *   - daemon `mode: 'metabase' | 'advanced'` → kept verbatim
 *   - daemon `scope: 'tenant' | 'user'` → kept verbatim
 *   - daemon `isDefault` → kept verbatim (NOT mapped to legacy `default`)
 *
 * The stage-1 mock-store types in `@/api/resources/dashboards.ts` use
 * snake-case + a different scope vocabulary; we deliberately do NOT
 * convert here. The daemon DTO is the canonical stage-2 shape and
 * route-level code consumes it directly.
 */
import {
  createDashboard as createDashboardCall,
  deleteDashboard as deleteDashboardCall,
  deleteDashboardShare as deleteDashboardShareCall,
  exportDashboard as exportDashboardCall,
  getDashboard as getDashboardCall,
  importDashboard as importDashboardCall,
  listDashboardShares as listDashboardSharesCall,
  listDashboardVersions as listDashboardVersionsCall,
  listDashboards as listDashboardsCall,
  patchDashboard as patchDashboardCall,
  restoreDashboardVersion as restoreDashboardVersionCall,
  setDashboardHome as setDashboardHomeCall,
  setDefaultDashboard as setDefaultDashboardCall,
  shareDashboard as shareDashboardCall,
  snapshotDashboard as snapshotDashboardCall,
  updateDashboard as updateDashboardCall,
} from '@/api/generated/dashboards/dashboards';
import type {
  CreateDashboardRequest,
  Dashboard as DaemonDashboard,
  DashboardExport,
  DashboardList,
  DashboardShare,
  DashboardShareList,
  DashboardVersion,
  DashboardVersionList,
  ShareDashboardRequest,
  SnapshotRequest,
  UpdateDashboardRequest,
} from '@/api/generated/schemas';

export type {
  CreateDashboardRequest,
  DaemonDashboard,
  DashboardExport,
  DashboardList,
  DashboardShare,
  DashboardShareList,
  DashboardVersion,
  DashboardVersionList,
  ShareDashboardRequest,
  SnapshotRequest,
  UpdateDashboardRequest,
};

/**
 * The orval `httpClient: 'fetch'` mode generates response wrappers
 * shaped as `{ data, status, headers }`. Our `customFetch` mutator
 * returns that wrapper at runtime (see `runOrvalFetch` in
 * `src/api/mutator.ts`). For tests that mock `customFetch` to return
 * the body directly, we fall back to the value when no `.data`
 * attribute is present.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function unwrap<T>(result: unknown): T {
  if (result !== null && typeof result === 'object' && 'data' in result) {
    const r = result as { data: unknown };
    if (r.data !== undefined) return r.data as T;
  }
  return result as T;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function listDashboardsViaDaemon(tenant: string): Promise<DashboardList> {
  return unwrap<DashboardList>(await listDashboardsCall(tenant));
}

export async function getDashboardViaDaemon(tenant: string, id: string): Promise<DaemonDashboard> {
  return unwrap<DaemonDashboard>(await getDashboardCall(tenant, id));
}

export async function listDashboardVersionsViaDaemon(
  tenant: string,
  id: string,
): Promise<DashboardVersionList> {
  return unwrap<DashboardVersionList>(await listDashboardVersionsCall(tenant, id));
}

export async function listDashboardSharesViaDaemon(
  tenant: string,
  id: string,
): Promise<DashboardShareList> {
  return unwrap<DashboardShareList>(await listDashboardSharesCall(tenant, id));
}

export async function exportDashboardViaDaemon(
  tenant: string,
  id: string,
): Promise<DashboardExport> {
  return unwrap<DashboardExport>(await exportDashboardCall(tenant, id));
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export async function createDashboardViaDaemon(
  tenant: string,
  body: CreateDashboardRequest,
): Promise<DaemonDashboard> {
  return unwrap<DaemonDashboard>(await createDashboardCall(tenant, body));
}

export async function updateDashboardViaDaemon(
  tenant: string,
  id: string,
  body: UpdateDashboardRequest,
): Promise<DaemonDashboard> {
  return unwrap<DaemonDashboard>(await updateDashboardCall(tenant, id, body));
}

export async function patchDashboardViaDaemon(
  tenant: string,
  id: string,
  body: UpdateDashboardRequest,
): Promise<DaemonDashboard> {
  return unwrap<DaemonDashboard>(await patchDashboardCall(tenant, id, body));
}

export async function deleteDashboardViaDaemon(tenant: string, id: string): Promise<void> {
  await deleteDashboardCall(tenant, id);
}

export async function setDefaultDashboardViaDaemon(
  tenant: string,
  id: string,
): Promise<DaemonDashboard> {
  return unwrap<DaemonDashboard>(await setDefaultDashboardCall(tenant, id));
}

/**
 * Sets the dashboard as the calling user's personal home dashboard
 * (server reads the user id from the session cookie).
 *
 * T5: when both a tenant-default dashboard and a personal home are set,
 * the personal home wins for that user.
 */
export async function setDashboardHomeViaDaemon(
  tenant: string,
  id: string,
): Promise<DaemonDashboard> {
  return unwrap<DaemonDashboard>(await setDashboardHomeCall(tenant, id));
}

export async function snapshotDashboardViaDaemon(
  tenant: string,
  id: string,
  body: SnapshotRequest = {},
): Promise<DashboardVersion> {
  return unwrap<DashboardVersion>(await snapshotDashboardCall(tenant, id, body));
}

export async function restoreDashboardVersionViaDaemon(
  tenant: string,
  vid: string,
): Promise<DaemonDashboard> {
  return unwrap<DaemonDashboard>(await restoreDashboardVersionCall(tenant, vid));
}

export async function shareDashboardViaDaemon(
  tenant: string,
  id: string,
  body: ShareDashboardRequest,
): Promise<DashboardShare> {
  return unwrap<DashboardShare>(await shareDashboardCall(tenant, id, body));
}

export async function deleteDashboardShareViaDaemon(
  tenant: string,
  id: string,
  shareId: string,
): Promise<void> {
  await deleteDashboardShareCall(tenant, id, shareId);
}

export async function importDashboardViaDaemon(
  tenant: string,
  body: DashboardExport,
): Promise<DaemonDashboard> {
  return unwrap<DaemonDashboard>(await importDashboardCall(tenant, body));
}

/**
 * Resolve the effective home dashboard for the calling user.
 *
 * T5 contract: the personal home flag is per-user and overrides the
 * tenant default when set. Daemon-side, both flags live on the
 * dashboard row (`isDefault` + `homeForUsers[]`); we resolve client
 * side by walking the list.
 */
export function resolveEffectiveHomeDashboard(
  list: DashboardList,
  userId: string,
): DaemonDashboard | undefined {
  const items = list.items;
  for (const d of items) {
    if (d.homeForUsers.includes(userId)) {
      return d;
    }
  }
  for (const d of items) {
    if (d.isDefault) return d;
  }
  return undefined;
}
