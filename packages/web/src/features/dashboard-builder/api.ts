/**
 * Dashboard-builder API — widget CRUD, layout updates, and mode-flip logic.
 *
 * Shares the same mock store as the dashboards API but is scoped narrower:
 * the builder touches widgets + the parent dashboard's widget_ids + layout.
 */
import { useEffect, useState } from 'react';
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type {
  AuditEntry,
  Dashboard,
  Widget,
} from '@/api/resources/types';
import { BUILT_IN_WIDGETS } from '@/features/widgets/registry';
import { runWidgetQuery, WidgetQueryError } from '@/features/widgets/data-sources';
import {
  LayoutValidationError,
  WidgetFlipError,
} from './types';
import type {
  AddWidgetInput,
  UpdateWidgetInput,
  WidgetDataState,
} from './types';

const nextWidgetId = makeIdFactory('widget-b');
const nextAuditId = makeIdFactory('audit-bldr');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function getCurrentActorId(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
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
    resource_type: 'widget',
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier,
  };
}

function requireDashboard(id: string): Dashboard {
  const dashboard = useMockStore.getState().dashboards[id];
  if (!dashboard) throw new Error(`Dashboard ${id} not found`);
  return dashboard;
}

// ─── Hook: useWidgetData ──────────────────────────────────────────────────────

/**
 * Runs `runWidgetQuery` with simulated latency and returns loading/error/data.
 * Re-runs whenever the widget's mutable fields change.
 */
export function useWidgetData(widget: Widget | undefined): WidgetDataState {
  const [state, setState] = useState<WidgetDataState>({ data: undefined, loading: true });

  const signature = widget
    ? `${widget.id}|${widget.kind}|${widget.data_source}|${widget.raw_query}|${String(widget.updated_at)}`
    : 'none';

  useEffect(() => {
    if (!widget) {
      setState({ data: undefined, loading: false });
      return;
    }
    let cancelled = false;
    setState({ data: undefined, loading: true });
    void (async () => {
      await simulateLatency('query');
      if (cancelled) return;
      try {
        const data = runWidgetQuery(widget, useMockStore.getState());
        if (!cancelled) setState({ data, loading: false });
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof WidgetQueryError ? e.message : 'Query failed';
          setState({ data: undefined, loading: false, error: msg });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  // signature encodes the subset of widget fields this hook reacts to
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return state;
}

// ─── Widget CRUD ──────────────────────────────────────────────────────────────

export async function addWidget(
  dashboardId: string,
  input: AddWidgetInput,
): Promise<Widget> {
  await simulateLatency('mutation');
  const dashboard = requireDashboard(dashboardId);

  const id = nextWidgetId();
  const position = input.position ?? {
    x: 0,
    y: Object.values(dashboard.layout).reduce((m, p) => (p.y + p.h > m ? p.y + p.h : m), 0),
    w: 4,
    h: 3,
  };

  const widget: Widget = {
    id,
    dashboard_id: dashboardId,
    kind: input.kind,
    title: input.title,
    config: input.config ?? {},
    position,
    data_source: input.data_source,
    raw_query: input.raw_query ?? '',
    ...(input.wizard_state !== undefined ? { wizard_state: input.wizard_state } : {}),
    locked_advanced: false,
    created_at: now(),
    updated_at: now(),
  };

  useMockStore.setState((s) => ({
    widgets: { ...s.widgets, [id]: widget },
    dashboards: {
      ...s.dashboards,
      [dashboardId]: {
        ...dashboard,
        widget_ids: [...dashboard.widget_ids, id],
        layout: { ...dashboard.layout, [id]: position },
        updated_at: now(),
      },
    },
  }));

  useMockStore
    .getState()
    .appendAudit(
      makeAuditEntry(getCurrentActorId(), dashboard.tenant_id, 'widget.create', id),
    );
  emitHostEvent('widget.created', { widget_id: id, dashboard_id: dashboardId });
  return widget;
}

export async function updateWidget(
  widgetId: string,
  input: UpdateWidgetInput,
): Promise<Widget> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.widgets[widgetId];
  if (!current) throw new Error(`Widget ${widgetId} not found`);
  const dashboard = state.dashboards[current.dashboard_id];

  const patch: Partial<Widget> = { updated_at: now() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.data_source !== undefined) patch.data_source = input.data_source;
  if (input.config !== undefined) patch.config = input.config;
  if (input.raw_query !== undefined) patch.raw_query = input.raw_query;
  if (input.wizard_state !== undefined) patch.wizard_state = input.wizard_state;
  if (input.locked_advanced !== undefined) patch.locked_advanced = input.locked_advanced;

  state.updateEntity('widgets', widgetId, patch);
  const updated = useMockStore.getState().widgets[widgetId];
  if (!updated) throw new Error(`Widget ${widgetId} vanished mid-update`);
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), dashboard?.tenant_id ?? null, 'widget.update', widgetId),
  );
  emitHostEvent('widget.updated', { widget_id: widgetId, dashboard_id: current.dashboard_id });
  return updated;
}

export async function removeWidget(dashboardId: string, widgetId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const dashboard = state.dashboards[dashboardId];
  if (!dashboard) throw new Error(`Dashboard ${dashboardId} not found`);
  if (!state.widgets[widgetId]) return;

  useMockStore.setState((s) => {
    const nextWidgets = { ...s.widgets };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete nextWidgets[widgetId];
    const nextLayout = { ...dashboard.layout };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete nextLayout[widgetId];
    return {
      widgets: nextWidgets,
      dashboards: {
        ...s.dashboards,
        [dashboardId]: {
          ...dashboard,
          widget_ids: dashboard.widget_ids.filter((id) => id !== widgetId),
          layout: nextLayout,
          updated_at: now(),
        },
      },
    };
  });
  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      dashboard.tenant_id,
      'widget.delete',
      widgetId,
      'destructive',
    ),
  );
  emitHostEvent('widget.deleted', { widget_id: widgetId, dashboard_id: dashboardId });
}

// ─── Layout ───────────────────────────────────────────────────────────────────

/**
 * Full-replace the dashboard's layout record. Validates that every key
 * references a widget currently attached to the dashboard.
 */
export async function updateLayout(
  dashboardId: string,
  layout: Record<string, { x: number; y: number; w: number; h: number }>,
): Promise<Dashboard> {
  await simulateLatency('mutation');
  const dashboard = requireDashboard(dashboardId);

  const widgetSet = new Set(dashboard.widget_ids);
  for (const key of Object.keys(layout)) {
    if (!widgetSet.has(key)) {
      throw new LayoutValidationError(
        `Layout references widget ${key} not attached to dashboard ${dashboardId}`,
      );
    }
  }

  useMockStore.setState((s) => ({
    dashboards: {
      ...s.dashboards,
      [dashboardId]: {
        ...dashboard,
        layout,
        updated_at: now(),
      },
    },
  }));
  useMockStore
    .getState()
    .appendAudit(
      makeAuditEntry(
        getCurrentActorId(),
        dashboard.tenant_id,
        'dashboard.layout',
        dashboardId,
      ),
    );
  emitHostEvent('dashboard.layout-updated', { dashboard_id: dashboardId });
  const after = useMockStore.getState().dashboards[dashboardId];
  if (!after) throw new Error('Dashboard vanished');
  return after;
}

// ─── Mode flip ────────────────────────────────────────────────────────────────

/** Sets `locked_advanced: true` unconditionally. */
export async function flipWidgetToAdvanced(widgetId: string): Promise<Widget> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const widget = state.widgets[widgetId];
  if (!widget) throw new Error(`Widget ${widgetId} not found`);

  state.updateEntity('widgets', widgetId, {
    locked_advanced: true,
    updated_at: now(),
  });
  const dashboard = state.dashboards[widget.dashboard_id];
  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      dashboard?.tenant_id ?? null,
      'widget.flip-to-advanced',
      widgetId,
    ),
  );
  emitHostEvent('widget.flip-to-advanced', { widget_id: widgetId });
  const after = useMockStore.getState().widgets[widgetId];
  if (!after) throw new Error('Widget vanished');
  return after;
}

/**
 * Allowed only when the widget's kind has `roundTripMode: 'clean'` AND the
 * widget is not already locked. Throws WidgetFlipError otherwise.
 */
export async function flipWidgetToWizard(widgetId: string): Promise<Widget> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const widget = state.widgets[widgetId];
  if (!widget) throw new Error(`Widget ${widgetId} not found`);

  const definition = BUILT_IN_WIDGETS[widget.kind];
  if (!definition) {
    throw new WidgetFlipError(
      `Cannot flip widget to wizard: kind "${widget.kind}" is not a built-in type.`,
    );
  }
  if (definition.roundTripMode !== 'clean') {
    throw new WidgetFlipError(
      `Cannot flip widget to wizard: type "${widget.kind}" is one-way (wizard view is disabled).`,
    );
  }
  if (widget.locked_advanced) {
    throw new WidgetFlipError('Cannot flip widget to wizard: widget is locked to advanced mode.');
  }

  state.updateEntity('widgets', widgetId, {
    raw_query: '',
    updated_at: now(),
  });
  const dashboard = state.dashboards[widget.dashboard_id];
  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      dashboard?.tenant_id ?? null,
      'widget.flip-to-wizard',
      widgetId,
    ),
  );
  emitHostEvent('widget.flip-to-wizard', { widget_id: widgetId });
  const after = useMockStore.getState().widgets[widgetId];
  if (!after) throw new Error('Widget vanished');
  return after;
}
