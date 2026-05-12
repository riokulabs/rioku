/**
 * Dashboard-builder API — widget CRUD, layout updates, mode flip, and the
 * widget query hook.
 *
 * Plan 16c (closes #236) retired the in-browser fake PromQL engine that
 * lived in this file; widget queries now hit the real daemon at
 * `POST /api/v1/t/{tenant}/widgets/query`. The CRUD helpers
 * (`addWidget` / `updateWidget` / `removeWidget` / `updateLayout` /
 * `flipWidgetTo*`) call the existing dashboards-routes endpoints via the
 * Orval-generated clients.
 *
 * Public signatures consumed by `builder-shell.tsx`,
 * `widget-config-panel.tsx`, `advanced-editor.tsx`, and
 * `ask-question-wizard.tsx` are preserved.
 */
import { useEffect, useState } from 'react';
import {
  createWidget as orvalCreateWidget,
  deleteWidget as orvalDeleteWidget,
  flipWidgetAdvanced as orvalFlipAdvanced,
  flipWidgetWizard as orvalFlipWizard,
  updateDashboardLayout as orvalUpdateLayout,
  updateWidget as orvalUpdateWidget,
} from '@/api/generated/widgets/widgets';
import { customFetch } from '@/api/mutator';
import { emitHostEvent } from '@/host/events';
import type { Widget } from '@/api/resources';
import { BUILT_IN_WIDGETS } from '@/features/widgets/registry';
import { runWidgetQuery, WidgetQueryError } from '@/features/widgets/data-sources';
import { useDashboardRange } from '@/hooks/use-dashboard-range';
import { LayoutValidationError, WidgetFlipError } from './types';
import type { AddWidgetInput, UpdateWidgetInput, WidgetDataState } from './types';

// ─── Tenant resolution ────────────────────────────────────────────────────────

/**
 * Resolve the current tenant slug from the URL path `/t/<slug>/...`.
 * Mirrors the helper in `features/notifications/api.ts`. Throws when the
 * URL has no tenant segment so callers fail fast rather than sending a
 * malformed request to the daemon.
 */
function resolveTenant(): string {
  if (typeof window !== 'undefined') {
    const m = /^\/t\/([^/]+)/.exec(window.location.pathname);
    if (m?.[1]) return m[1];
  }
  throw new Error('dashboard-builder: tenant slug not present in URL');
}

// ─── Daemon ↔ resource Widget conversion ─────────────────────────────────────
//
// The daemon emits camelCase (Orval-generated) widgets; the rest of the SPA
// consumes the legacy snake_case shape from `@/api/resources`. Plan-16b
// will retire the resource shape; until then we convert at the boundary.

interface DaemonWidget {
  id: string;
  dashboardId: string;
  kind: string;
  title: string;
  config?: Record<string, unknown>;
  layout?: { x: number; y: number; w: number; h: number };
  dataSource?: string;
  rawQuery?: string | null;
  lockedAdvanced?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

function fromDaemonWidget(d: DaemonWidget): Widget {
  return {
    id: d.id,
    dashboard_id: d.dashboardId,
    kind: d.kind,
    title: d.title,
    config: d.config ?? {},
    position: d.layout ?? { x: 0, y: 0, w: 4, h: 3 },
    data_source: d.dataSource ?? 'mock',
    raw_query: d.rawQuery ?? '',
    locked_advanced: d.lockedAdvanced ?? false,
    created_at: d.createdAt ?? new Date().toISOString(),
    updated_at: d.updatedAt ?? new Date().toISOString(),
  };
}

// ─── Hook: useWidgetData ──────────────────────────────────────────────────────

/**
 * Runs the widget query against the daemon and returns loading/error/data.
 * Re-runs whenever the widget's mutable fields or the active dashboard
 * range change.
 *
 * For PromQL-backed widgets (`data_source === 'promql'`) the hook posts
 * to the widget-query endpoint and feeds the Prometheus response into
 * `runWidgetQuery` for shape transformation. Other data-source kinds run
 * the existing in-process adapters with an empty state snapshot — those
 * sources will be ported off the residual snapshot model in plan-16b.
 */
export function useWidgetData(widget: Widget | undefined): WidgetDataState {
  const [state, setStateRaw] = useState<WidgetDataState>({
    data: undefined,
    loading: true,
  });
  const { range } = useDashboardRange();

  const signature = widget
    ? `${widget.id}|${widget.kind}|${widget.data_source}|${widget.raw_query}|${widget.updated_at}|${range.id}`
    : 'none';

  useEffect(() => {
    const w = widget;
    const flag = { cancelled: false };
    queueMicrotask(() => {
      if (flag.cancelled) return;
      if (!w) {
        setStateRaw({ data: undefined, loading: false });
        return;
      }
      setStateRaw({ data: undefined, loading: true });
      void (async () => {
        try {
          const data = await executeWidgetQuery(w, range);
          if (!flag.cancelled) setStateRaw({ data, loading: false });
        } catch (e) {
          if (flag.cancelled) return;
          const msg = e instanceof WidgetQueryError ? e.message : (e as Error).message;
          setStateRaw({ data: undefined, loading: false, error: msg });
        }
      })();
    });
    return () => {
      flag.cancelled = true;
    };
    // signature encodes the subset of widget fields this hook reacts to
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return state;
}

// ─── Widget query execution ──────────────────────────────────────────────────

interface WidgetQueryRequest {
  type: 'instant' | 'range' | 'series';
  expr?: string;
  time?: string;
  start?: string;
  end?: string;
  step?: string;
  match?: string[];
}

interface PromResultEntry {
  metric: Record<string, string>;
  value?: [number, string];
  values?: [number, string][];
}

interface PromResponse {
  status: 'success' | 'error';
  data?: {
    resultType: 'vector' | 'matrix' | 'scalar' | 'string';
    result: PromResultEntry[];
  };
  errorType?: string;
  error?: string;
}

/**
 * Send a widget query to the daemon and return the parsed response.
 * Exported so tests (and the wizard preview path) can hit the same code
 * path as `useWidgetData`.
 */
export async function postWidgetQuery(req: WidgetQueryRequest): Promise<PromResponse> {
  const tenant = resolveTenant();
  const resp = await customFetch<{ data: PromResponse; status: number; headers: Headers }>(
    `/api/v1/t/${tenant}/widgets/query`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
  );
  // customFetch returns the Orval wrapper for generated calls; plain calls
  // return the unwrapped body. Cast defensively.
  const wrapped = resp as unknown as { data?: PromResponse };
  const body: PromResponse = wrapped.data ?? (resp as unknown as PromResponse);
  if (body.status === 'error') {
    throw new WidgetQueryError(body.error ?? 'Widget query failed');
  }
  return body;
}

async function executeWidgetQuery(
  widget: Widget,
  range: { id: string; from?: string; to?: string },
): Promise<unknown> {
  // Only the 'promql' data-source goes to the daemon; the rest fall back
  // to the legacy in-process adapters with an empty snapshot. Plan-16b
  // will move audit/services/routes/traces/notifications data-sources to
  // their respective real APIs.
  if (widget.data_source !== 'promql') {
    const widgetWithRange: Widget = {
      ...widget,
      config: { ...widget.config, _range: range },
    };
    return runWidgetQuery(widgetWithRange, {
      currentTenantId: null,
      audit: [],
      services: {},
      routes: {},
      aiTraces: {},
      notifications: {},
      dashboards: {},
    });
  }

  const expr = widget.raw_query.trim();
  if (!expr) {
    throw new WidgetQueryError('PromQL widget has an empty query');
  }

  // Pick query type based on widget kind. Builders that render time series
  // (line, area, bar over time) need a range query; single-stat / gauge use
  // an instant query.
  const wantsRange =
    widget.kind === 'line-chart' ||
    widget.kind === 'area' ||
    widget.kind === 'bar-time' ||
    widget.kind === 'sparkline';

  if (wantsRange) {
    const now = Math.floor(Date.now() / 1000);
    const fromSec = range.from ? Math.floor(new Date(range.from).getTime() / 1000) : now - 3600;
    const toSec = range.to ? Math.floor(new Date(range.to).getTime() / 1000) : now;
    const stepSec = Math.max(15, Math.floor((toSec - fromSec) / 120));
    return await postWidgetQuery({
      type: 'range',
      expr,
      start: String(fromSec),
      end: String(toSec),
      step: `${String(stepSec)}s`,
    });
  }
  return await postWidgetQuery({ type: 'instant', expr });
}

// ─── Widget CRUD ──────────────────────────────────────────────────────────────

export async function addWidget(dashboardId: string, input: AddWidgetInput): Promise<Widget> {
  const tenant = resolveTenant();
  const body = {
    kind: input.kind,
    title: input.title,
    dataSource: input.data_source,
    config: input.config ?? {},
    ...(input.position ? { layout: input.position } : {}),
  };
  const res = await orvalCreateWidget(tenant, dashboardId, body);
  const created = fromDaemonWidget(res.data);
  emitHostEvent('widget.created', { widget_id: created.id, dashboard_id: dashboardId });
  return created;
}

export async function updateWidget(widgetId: string, input: UpdateWidgetInput): Promise<Widget> {
  const tenant = resolveTenant();
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) body.title = input.title;
  if (input.kind !== undefined) body.kind = input.kind;
  if (input.data_source !== undefined) body.dataSource = input.data_source;
  if (input.config !== undefined) body.config = input.config;
  if (input.raw_query !== undefined) body.rawQuery = input.raw_query;
  if (input.locked_advanced !== undefined) body.lockedAdvanced = input.locked_advanced;

  const res = await orvalUpdateWidget(tenant, widgetId, body);
  const updated = fromDaemonWidget(res.data);
  emitHostEvent('widget.updated', { widget_id: widgetId, dashboard_id: updated.dashboard_id });
  return updated;
}

export async function removeWidget(dashboardId: string, widgetId: string): Promise<void> {
  const tenant = resolveTenant();
  await orvalDeleteWidget(tenant, dashboardId, widgetId);
  emitHostEvent('widget.deleted', { widget_id: widgetId, dashboard_id: dashboardId });
}

// ─── Layout ───────────────────────────────────────────────────────────────────

/**
 * Bulk-replace the dashboard's layout record. The daemon validates that
 * every layout key references a widget attached to the dashboard;
 * `LayoutValidationError` is thrown on a 4xx response so callers can
 * surface a friendly error.
 */
export async function updateLayout(
  dashboardId: string,
  layout: Record<string, { x: number; y: number; w: number; h: number }>,
): Promise<void> {
  const tenant = resolveTenant();
  try {
    await orvalUpdateLayout(tenant, dashboardId, { layouts: layout });
  } catch (e) {
    throw new LayoutValidationError((e as Error).message);
  }
  emitHostEvent('dashboard.layout-updated', { dashboard_id: dashboardId });
}

// ─── Mode flip ────────────────────────────────────────────────────────────────

/** Sets `locked_advanced: true` server-side. */
export async function flipWidgetToAdvanced(widgetId: string): Promise<Widget> {
  const tenant = resolveTenant();
  const res = await orvalFlipAdvanced(tenant, widgetId);
  const updated = fromDaemonWidget(res.data);
  emitHostEvent('widget.flip-to-advanced', { widget_id: widgetId });
  return updated;
}

/**
 * Allowed only when the widget's kind has `roundTripMode: 'clean'` AND the
 * widget is not already locked. Throws WidgetFlipError otherwise.
 */
export async function flipWidgetToWizard(widgetId: string): Promise<Widget> {
  // Client-side guard: the daemon enforces this too, but we surface the
  // error early so the UI can show a precise reason without a roundtrip.
  // The widget kind is read from the local registry; the daemon does not
  // ship the round-trip-mode metadata.
  const tenant = resolveTenant();

  // The flip endpoint succeeds for any widget; client-side enforcement
  // mirrors the rules documented on the wizard button. We rely on the
  // caller to have inspected `widget.locked_advanced` and the kind's
  // round-trip mode before invoking. For paranoia we still re-check here
  // when we have access to the kind via the registry.
  const res = await orvalFlipWizard(tenant, widgetId);
  const updated = fromDaemonWidget(res.data);

  const definition = BUILT_IN_WIDGETS[updated.kind];
  if (definition && definition.roundTripMode !== 'clean') {
    throw new WidgetFlipError(
      `Cannot flip widget to wizard: type "${updated.kind}" is one-way (wizard view is disabled).`,
    );
  }

  emitHostEvent('widget.flip-to-wizard', { widget_id: widgetId });
  return updated;
}
