/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Dashboards API tests — covers CRUD, version snapshot/restore, set-default
 * atomicity, set-as-my-home, and JSON export/import.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  createDashboard,
  deleteDashboard,
  exportDashboardJson,
  importDashboardJson,
  restoreDashboardVersion,
  setAsMyHome,
  setDefaultDashboard,
  snapshotDashboard,
  updateDashboard,
} from '../api';
import { DASHBOARD_EXPORT_VERSION, DashboardImportError } from '../types';

function acmeTenantId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  return acme.id;
}

function firstAcmeDashboardId(): string {
  const tid = acmeTenantId();
  const dashboards = Object.values(useMockStore.getState().dashboards).filter(
    (d) => d.tenant_id === tid,
  );
  if (dashboards.length === 0) throw new Error('No acme dashboard seeded');
  return dashboards[0]!.id;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  // Pretend derrick is the current user.
  const derrick = Object.values(useMockStore.getState().users).find(
    (u) => u.email === 'derrick@acme.com',
  );
  useMockStore.setState({ currentUserId: derrick?.id ?? 'user-0000' });
});

describe('createDashboard', () => {
  it('creates a dashboard with defaults', async () => {
    const tid = acmeTenantId();
    const d = await createDashboard(tid, { name: 'New one' });
    expect(d.tenant_id).toBe(tid);
    expect(d.mode).toBe('metabase');
    expect(d.scope).toBe('tenant');
    expect(d.widget_ids).toEqual([]);
    expect(useMockStore.getState().dashboards[d.id]).toBeDefined();
  });

  it('emits an audit entry', async () => {
    const tid = acmeTenantId();
    const beforeLen = useMockStore.getState().audit.length;
    await createDashboard(tid, { name: 'Audited' });
    const after = useMockStore.getState().audit;
    expect(after.length).toBeGreaterThan(beforeLen);
    expect(after[after.length - 1]!.action).toBe('dashboard.create');
  });
});

describe('updateDashboard', () => {
  it('patches fields and bumps updated_at', async () => {
    const id = firstAcmeDashboardId();
    const before = useMockStore.getState().dashboards[id]!;
    const updated = await updateDashboard(id, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect(updated.updated_at).not.toBe(before.updated_at);
  });

  it('throws on unknown id', async () => {
    await expect(updateDashboard('nope', { name: 'x' })).rejects.toThrow();
  });
});

describe('deleteDashboard', () => {
  it('removes the dashboard and its widgets + versions atomically', async () => {
    const id = firstAcmeDashboardId();
    const widgetIds = useMockStore.getState().dashboards[id]!.widget_ids;
    await deleteDashboard(id);
    const state = useMockStore.getState();
    expect(state.dashboards[id]).toBeUndefined();
    for (const wid of widgetIds) {
      expect(state.widgets[wid]).toBeUndefined();
    }
    const orphanVersions = Object.values(state.dashboardVersions).filter(
      (v) => v.dashboard_id === id,
    );
    expect(orphanVersions).toHaveLength(0);
  });
});

describe('setDefaultDashboard', () => {
  it('flips default on target and clears prior default atomically', async () => {
    const tid = acmeTenantId();
    const dashboards = Object.values(useMockStore.getState().dashboards).filter(
      (d) => d.tenant_id === tid,
    );
    const prevDefault = dashboards.find((d) => d.default);
    const target = dashboards.find((d) => !d.default);
    if (!prevDefault || !target) throw new Error('Test requires at least two tenant dashboards');

    await setDefaultDashboard(tid, target.id);
    const state = useMockStore.getState();
    expect(state.dashboards[target.id]?.default).toBe(true);
    expect(state.dashboards[prevDefault.id]?.default).toBe(false);
  });
});

describe('setAsMyHome', () => {
  it('writes a per-user home override', async () => {
    const id = firstAcmeDashboardId();
    const uid = useMockStore.getState().currentUserId!;
    await setAsMyHome(uid, id);
    expect(useMockStore.getState().userHomeDashboards[uid]).toBe(id);
  });
});

describe('snapshotDashboard + restoreDashboardVersion', () => {
  it('snapshots the current dashboard + widgets as a new version entry', async () => {
    const id = firstAcmeDashboardId();
    const before = Object.values(useMockStore.getState().dashboardVersions).filter(
      (v) => v.dashboard_id === id,
    ).length;
    const version = await snapshotDashboard(id, 'manual test');
    expect(version.dashboard_id).toBe(id);
    const after = Object.values(useMockStore.getState().dashboardVersions).filter(
      (v) => v.dashboard_id === id,
    ).length;
    expect(after).toBe(before + 1);
    expect(version.snapshot.widgets.length).toBeGreaterThan(0);
  });

  it('restore replaces dashboard + widgets and records a marker version', async () => {
    const id = firstAcmeDashboardId();
    const dashboard = useMockStore.getState().dashboards[id]!;
    // Rename so restore visibly rolls back.
    await updateDashboard(id, { name: 'Mutated' });
    const versions = Object.values(useMockStore.getState().dashboardVersions)
      .filter((v) => v.dashboard_id === id)
      .sort((a, b) => a.version - b.version);
    const firstVersion = versions[0]!;
    // Restore the first seeded version.
    await restoreDashboardVersion(firstVersion.id);
    const after = useMockStore.getState().dashboards[id]!;
    expect(after.name).toBe(dashboard.name);
    // A marker version should have been added.
    const versionsAfter = Object.values(useMockStore.getState().dashboardVersions).filter(
      (v) => v.dashboard_id === id,
    );
    expect(versionsAfter.length).toBe(versions.length + 1);
  });
});

describe('exportDashboardJson + importDashboardJson', () => {
  it('round-trips a dashboard via JSON with fresh ids', async () => {
    const id = firstAcmeDashboardId();
    const payload = exportDashboardJson(id);
    expect(payload.version).toBe(DASHBOARD_EXPORT_VERSION);

    const tid = acmeTenantId();
    const imported = await importDashboardJson(tid, JSON.stringify(payload));
    expect(imported.id).not.toBe(id);
    expect(imported.widget_ids.length).toBe(payload.widgets.length);
    // Every new widget id must appear in the store.
    const state = useMockStore.getState();
    for (const wid of imported.widget_ids) {
      expect(state.widgets[wid]).toBeDefined();
      expect(state.widgets[wid]?.dashboard_id).toBe(imported.id);
    }
    // Layout keys must map to the new ids.
    for (const newId of Object.keys(imported.layout)) {
      expect(imported.widget_ids).toContain(newId);
    }
  });

  it('rejects invalid JSON payloads with DashboardImportError', async () => {
    await expect(importDashboardJson(acmeTenantId(), '{not json')).rejects.toThrow(
      DashboardImportError,
    );
  });

  it('rejects payloads whose shape does not match the schema', async () => {
    await expect(importDashboardJson(acmeTenantId(), '{"version":"plan4-v1"}')).rejects.toThrow(
      DashboardImportError,
    );
  });

  it('rejects payloads with an unsupported version literal', async () => {
    const id = firstAcmeDashboardId();
    const payload = exportDashboardJson(id);
    const tampered = JSON.stringify({ ...payload, version: 'not-a-real-version' });
    await expect(importDashboardJson(acmeTenantId(), tampered)).rejects.toThrow(
      DashboardImportError,
    );
  });
});
