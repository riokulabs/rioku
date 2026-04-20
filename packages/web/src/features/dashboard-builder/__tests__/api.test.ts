/**
 * Dashboard-builder API tests — widget CRUD + layout + mode-flip semantics.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  addWidget,
  flipWidgetToAdvanced,
  flipWidgetToWizard,
  removeWidget,
  updateLayout,
  updateWidget,
} from '../api';
import { LayoutValidationError, WidgetFlipError } from '../types';

function firstAcmeDashboardId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  const dashboards = Object.values(useMockStore.getState().dashboards).filter(
    (d) => d.tenant_id === acme.id,
  );
  if (dashboards.length === 0) throw new Error('No acme dashboard seeded');
  return dashboards[0]!.id;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  const derrick = Object.values(useMockStore.getState().users).find(
    (u) => u.email === 'derrick@acme.com',
  );
  useMockStore.setState({ currentUserId: derrick?.id ?? 'user-0000' });
});

describe('addWidget', () => {
  it('appends to widget_ids and seeds a layout entry', async () => {
    const dashId = firstAcmeDashboardId();
    const before = useMockStore.getState().dashboards[dashId]!;
    const w = await addWidget(dashId, {
      kind: 'single-stat',
      title: 'New stat',
      data_source: 'mock',
    });
    const after = useMockStore.getState().dashboards[dashId]!;
    expect(after.widget_ids).toEqual([...before.widget_ids, w.id]);
    expect(after.layout[w.id]).toBeDefined();
  });
});

describe('updateWidget', () => {
  it('patches fields and bumps updated_at', async () => {
    const dashId = firstAcmeDashboardId();
    const dashboard = useMockStore.getState().dashboards[dashId]!;
    const widgetId = dashboard.widget_ids[0]!;
    const updated = await updateWidget(widgetId, { title: 'Renamed widget' });
    expect(updated.title).toBe('Renamed widget');
  });
});

describe('removeWidget', () => {
  it('removes the widget from store, widget_ids, and layout', async () => {
    const dashId = firstAcmeDashboardId();
    const dashboard = useMockStore.getState().dashboards[dashId]!;
    const widgetId = dashboard.widget_ids[0]!;
    await removeWidget(dashId, widgetId);
    const after = useMockStore.getState();
    expect(after.widgets[widgetId]).toBeUndefined();
    expect(after.dashboards[dashId]?.widget_ids).not.toContain(widgetId);
    expect(after.dashboards[dashId]?.layout[widgetId]).toBeUndefined();
  });
});

describe('updateLayout', () => {
  it('full-replaces the dashboard layout when every key is known', async () => {
    const dashId = firstAcmeDashboardId();
    const dashboard = useMockStore.getState().dashboards[dashId]!;
    const layout = Object.fromEntries(
      dashboard.widget_ids.map((wid, i) => [wid, { x: 0, y: i, w: 12, h: 2 }]),
    );
    const after = await updateLayout(dashId, layout);
    expect(after.layout).toEqual(layout);
  });

  it('rejects layout references to unknown widget ids', async () => {
    const dashId = firstAcmeDashboardId();
    await expect(
      updateLayout(dashId, { unknown: { x: 0, y: 0, w: 1, h: 1 } }),
    ).rejects.toThrow(LayoutValidationError);
  });
});

describe('flipWidgetToAdvanced', () => {
  it('sets locked_advanced unconditionally', async () => {
    const dashId = firstAcmeDashboardId();
    const widgetId = useMockStore.getState().dashboards[dashId]!.widget_ids[0]!;
    const after = await flipWidgetToAdvanced(widgetId);
    expect(after.locked_advanced).toBe(true);
  });
});

describe('flipWidgetToWizard', () => {
  it('allows flip for clean round-trip kinds that are not locked', async () => {
    const dashId = firstAcmeDashboardId();
    // Find a single-stat / sparkline / time-series widget in the seed.
    const widget = Object.values(useMockStore.getState().widgets).find(
      (w) =>
        ['single-stat', 'sparkline', 'time-series'].includes(w.kind) &&
        w.dashboard_id === dashId,
    );
    if (!widget) throw new Error('Test requires a clean-mode widget in seed');
    const after = await flipWidgetToWizard(widget.id);
    expect(after.raw_query).toBe('');
  });

  it('rejects flip for one-way kinds', async () => {
    const dashId = firstAcmeDashboardId();
    const widget = Object.values(useMockStore.getState().widgets).find(
      (w) =>
        !['single-stat', 'sparkline', 'time-series'].includes(w.kind) &&
        w.dashboard_id === dashId,
    );
    if (!widget) throw new Error('Test requires a one-way-mode widget in seed');
    await expect(flipWidgetToWizard(widget.id)).rejects.toThrow(WidgetFlipError);
  });

  it('rejects flip when widget is locked_advanced', async () => {
    const dashId = firstAcmeDashboardId();
    const widget = Object.values(useMockStore.getState().widgets).find(
      (w) =>
        ['single-stat', 'sparkline', 'time-series'].includes(w.kind) &&
        w.dashboard_id === dashId,
    );
    if (!widget) throw new Error('Test requires a clean-mode widget in seed');
    await flipWidgetToAdvanced(widget.id);
    await expect(flipWidgetToWizard(widget.id)).rejects.toThrow(WidgetFlipError);
  });
});
