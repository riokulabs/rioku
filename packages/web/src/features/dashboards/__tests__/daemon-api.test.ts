/**
 * Daemon-backed dashboards API tests (Plan 08 T2/T5).
 *
 * Stubs `customFetch` to assert the adapter:
 *   1. Hits the canonical daemon URLs.
 *   2. Returns the daemon DTO unaltered (camelCase, no remap).
 *   3. Resolves the personal-home → tenant-default precedence
 *      correctly per T5.
 *
 * The orval-generated clients (which the daemon-api wraps) call
 * `customFetch(url, RequestInit)` — positional, not the project's
 * legacy object-arg shape. Tests assert that positional shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/mutator', () => {
  return {
    customFetch: vi.fn(),
    setAuthFailureHandler: vi.fn(),
  };
});

import { customFetch } from '@/api/mutator';
import {
  createDashboardViaDaemon,
  deleteDashboardViaDaemon,
  exportDashboardViaDaemon,
  getDashboardViaDaemon,
  importDashboardViaDaemon,
  listDashboardsViaDaemon,
  patchDashboardViaDaemon,
  resolveEffectiveHomeDashboard,
  restoreDashboardVersionViaDaemon,
  setDashboardHomeViaDaemon,
  setDefaultDashboardViaDaemon,
  shareDashboardViaDaemon,
  snapshotDashboardViaDaemon,
} from '../daemon-api';
import type { DaemonDashboard, DashboardExport, DashboardList } from '../daemon-api';

const fetchMock = customFetch as unknown as ReturnType<typeof vi.fn>;

interface OrvalCall {
  url: string;
  method: string;
  body?: unknown;
}

function capturedCall(): OrvalCall {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error('customFetch was not called');
  const [url, init] = call as [string, RequestInit];
  const method = init.method ?? 'GET';
  let body: unknown;
  if (typeof init.body === 'string') {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = init.body;
    }
  }
  return { url, method, ...(body !== undefined ? { body } : {}) };
}

const sampleDashboard: DaemonDashboard = {
  id: 'd1',
  tenantId: 't1',
  name: 'Default',
  description: '',
  mode: 'metabase',
  scope: 'tenant',
  isDefault: true,
  sharedRoleIds: [],
  homeForUsers: [],
  variables: [],
  createdAt: '2026-05-06T00:00:00.000Z',
  updatedAt: '2026-05-06T00:00:00.000Z',
};

beforeEach(() => fetchMock.mockReset());
afterEach(() => fetchMock.mockReset());

describe('dashboards daemon-api — reads', () => {
  it('listDashboardsViaDaemon GETs the tenant-scoped collection', async () => {
    fetchMock.mockResolvedValueOnce({ items: [sampleDashboard], total: 1 });

    const out = await listDashboardsViaDaemon('acme');

    const c = capturedCall();
    expect(c.url).toBe('/api/v1/t/acme/dashboards');
    expect(c.method).toBe('GET');
    expect(out.total).toBe(1);
    expect(out.items[0]?.id).toBe('d1');
  });

  it('getDashboardViaDaemon returns the daemon DTO verbatim', async () => {
    fetchMock.mockResolvedValueOnce(sampleDashboard);
    const out = await getDashboardViaDaemon('acme', 'd1');
    expect(out.mode).toBe('metabase');
    expect(out.scope).toBe('tenant');
    expect(out.isDefault).toBe(true);
  });

  it('exportDashboardViaDaemon returns the export payload', async () => {
    const payload: DashboardExport = { dashboard: sampleDashboard, widgets: [] };
    fetchMock.mockResolvedValueOnce(payload);
    const out = await exportDashboardViaDaemon('acme', 'd1');
    expect(out.dashboard.id).toBe('d1');
  });
});

describe('dashboards daemon-api — writes', () => {
  it('createDashboardViaDaemon POSTs the create body', async () => {
    fetchMock.mockResolvedValueOnce({ ...sampleDashboard, id: 'd2' });
    const out = await createDashboardViaDaemon('acme', { name: 'New' });
    expect(out.id).toBe('d2');
    const c = capturedCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('/api/v1/t/acme/dashboards');
    expect(c.body).toEqual({ name: 'New' });
  });

  it('patchDashboardViaDaemon sends a PATCH request', async () => {
    fetchMock.mockResolvedValueOnce(sampleDashboard);
    await patchDashboardViaDaemon('acme', 'd1', { name: 'Renamed' });
    const c = capturedCall();
    expect(c.method).toBe('PATCH');
    expect(c.body).toEqual({ name: 'Renamed' });
  });

  it('deleteDashboardViaDaemon DELETEs without a body', async () => {
    fetchMock.mockResolvedValueOnce(undefined);
    await deleteDashboardViaDaemon('acme', 'd1');
    const c = capturedCall();
    expect(c.method).toBe('DELETE');
    expect(c.url).toBe('/api/v1/t/acme/dashboards/d1');
  });

  it('snapshotDashboardViaDaemon POSTs the snapshot note', async () => {
    fetchMock.mockResolvedValueOnce({
      id: 'v1',
      dashboardId: 'd1',
      version: 1,
      createdAt: '2026-05-06T00:00:00Z',
      note: 'first',
      snapshot: {},
    });
    const out = await snapshotDashboardViaDaemon('acme', 'd1', { note: 'first' });
    expect(out.version).toBe(1);
    const c = capturedCall();
    expect(c.method).toBe('POST');
    expect(c.body).toEqual({ note: 'first' });
  });

  it('restoreDashboardVersionViaDaemon hits versions/{vid}/restore', async () => {
    fetchMock.mockResolvedValueOnce(sampleDashboard);
    await restoreDashboardVersionViaDaemon('acme', 'v1');
    const c = capturedCall();
    expect(c.url).toBe('/api/v1/t/acme/dashboards/versions/v1/restore');
    expect(c.method).toBe('POST');
  });

  it('shareDashboardViaDaemon POSTs the share grant', async () => {
    fetchMock.mockResolvedValueOnce({
      id: 'sh1',
      tenantId: 't1',
      dashboardId: 'd1',
      roleId: 'role-viewer',
      createdAt: '2026-05-06T00:00:00Z',
    });
    const out = await shareDashboardViaDaemon('acme', 'd1', { roleId: 'role-viewer' });
    expect(out.roleId).toBe('role-viewer');
  });

  it('importDashboardViaDaemon POSTs to /import', async () => {
    fetchMock.mockResolvedValueOnce(sampleDashboard);
    await importDashboardViaDaemon('acme', { dashboard: sampleDashboard, widgets: [] });
    const c = capturedCall();
    expect(c.url).toBe('/api/v1/t/acme/dashboards/import');
    expect(c.method).toBe('POST');
  });
});

describe('dashboards daemon-api — T5 default + home', () => {
  it('setDefaultDashboardViaDaemon hits the action sub-resource', async () => {
    fetchMock.mockResolvedValueOnce(sampleDashboard);
    await setDefaultDashboardViaDaemon('acme', 'd1');
    const c = capturedCall();
    expect(c.url).toBe('/api/v1/t/acme/dashboards/d1/set-default');
    expect(c.method).toBe('POST');
  });

  it('setDashboardHomeViaDaemon hits set-home', async () => {
    fetchMock.mockResolvedValueOnce(sampleDashboard);
    await setDashboardHomeViaDaemon('acme', 'd1');
    const c = capturedCall();
    expect(c.url).toBe('/api/v1/t/acme/dashboards/d1/set-home');
  });

  it('resolveEffectiveHomeDashboard prefers the personal home over the tenant default', () => {
    const list: DashboardList = {
      items: [
        { ...sampleDashboard, id: 'default-d', isDefault: true, homeForUsers: [] },
        { ...sampleDashboard, id: 'personal-d', isDefault: false, homeForUsers: ['user-1'] },
      ],
      total: 2,
    };
    const home = resolveEffectiveHomeDashboard(list, 'user-1');
    expect(home?.id).toBe('personal-d');
  });

  it('resolveEffectiveHomeDashboard falls back to tenant default when no personal home', () => {
    const list: DashboardList = {
      items: [
        { ...sampleDashboard, id: 'default-d', isDefault: true, homeForUsers: [] },
        { ...sampleDashboard, id: 'other-d', isDefault: false, homeForUsers: ['user-2'] },
      ],
      total: 2,
    };
    const home = resolveEffectiveHomeDashboard(list, 'user-1');
    expect(home?.id).toBe('default-d');
  });

  it('resolveEffectiveHomeDashboard returns undefined when neither flag is set', () => {
    const list: DashboardList = {
      items: [{ ...sampleDashboard, id: 'plain', isDefault: false, homeForUsers: [] }],
      total: 1,
    };
    expect(resolveEffectiveHomeDashboard(list, 'user-1')).toBeUndefined();
  });
});
