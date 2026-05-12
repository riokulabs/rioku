/**
 * Daemon-backed widgets API.
 *
 * Thin wrappers around the generated orval clients for widgets + dashboard
 * layout updates. Mirrors
 * `packages/daemon/internal/gateway/dashboards_routes.go`.
 *
 * The bulk-layout endpoint (`PUT /dashboards/{id}/layout`) is the sink for
 * drag-drop reorder events: after `@dnd-kit/sortable` commits, the client
 * sends `{ layouts: { wid: {x,y,w,h}, ... } }` server-side in a single
 * round-trip — see `updateLayoutViaDaemon`.
 */
import {
  createWidget as createWidgetCall,
  deleteWidget as deleteWidgetCall,
  flipWidgetAdvanced as flipWidgetAdvancedCall,
  flipWidgetWizard as flipWidgetWizardCall,
  listWidgets as listWidgetsCall,
  patchWidget as patchWidgetCall,
  updateDashboardLayout as updateDashboardLayoutCall,
  updateWidget as updateWidgetCall,
} from '@/api/generated/widgets/widgets';
import type {
  CreateWidgetRequest,
  UpdateLayoutRequest,
  UpdateWidgetRequest,
  Widget as DaemonWidget,
  WidgetList,
} from '@/api/generated/schemas';

export type {
  CreateWidgetRequest,
  DaemonWidget,
  UpdateLayoutRequest,
  UpdateWidgetRequest,
  WidgetList,
};

/**
 * `customFetch` returns the parsed JSON body, but orval's `httpClient: 'fetch'`
 * mode types each call as a `{ data, status, headers }` wrapper. The
 * wrapper is a type fiction; this helper reflects the real runtime
 * shape. See the matching note in `features/dashboards/daemon-api.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function unwrap<T>(result: unknown): T {
  return result as T;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function listWidgetsViaDaemon(
  tenant: string,
  dashboardId: string,
): Promise<WidgetList> {
  return unwrap<WidgetList>(await listWidgetsCall(tenant, dashboardId));
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export async function createWidgetViaDaemon(
  tenant: string,
  dashboardId: string,
  body: CreateWidgetRequest,
): Promise<DaemonWidget> {
  return unwrap<DaemonWidget>(await createWidgetCall(tenant, dashboardId, body));
}

export async function updateWidgetViaDaemon(
  tenant: string,
  widgetId: string,
  body: UpdateWidgetRequest,
): Promise<DaemonWidget> {
  return unwrap<DaemonWidget>(await updateWidgetCall(tenant, widgetId, body));
}

export async function patchWidgetViaDaemon(
  tenant: string,
  widgetId: string,
  body: UpdateWidgetRequest,
): Promise<DaemonWidget> {
  return unwrap<DaemonWidget>(await patchWidgetCall(tenant, widgetId, body));
}

export async function deleteWidgetViaDaemon(
  tenant: string,
  dashboardId: string,
  widgetId: string,
): Promise<void> {
  await deleteWidgetCall(tenant, dashboardId, widgetId);
}

/**
 * Lock a widget into advanced (raw query) mode — the wizard form is
 * hidden until `flipWidgetWizardViaDaemon` is called.
 */
export async function flipWidgetAdvancedViaDaemon(
  tenant: string,
  widgetId: string,
): Promise<DaemonWidget> {
  return unwrap<DaemonWidget>(await flipWidgetAdvancedCall(tenant, widgetId));
}

/** Reverse of `flipWidgetAdvancedViaDaemon`. */
export async function flipWidgetWizardViaDaemon(
  tenant: string,
  widgetId: string,
): Promise<DaemonWidget> {
  return unwrap<DaemonWidget>(await flipWidgetWizardCall(tenant, widgetId));
}

/**
 * Bulk layout update — single round-trip for drag-drop reorder. Send
 * the full per-widget `{x,y,w,h}` map; server replaces atomically.
 */
export async function updateLayoutViaDaemon(
  tenant: string,
  dashboardId: string,
  layouts: Record<string, { x: number; y: number; w: number; h: number }>,
): Promise<void> {
  const body: UpdateLayoutRequest = { layouts };
  await updateDashboardLayoutCall(tenant, dashboardId, body);
}
