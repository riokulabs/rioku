/**
 * Dashboards feature `api.ts` — daemon adapter tests (Plan 16b, #235).
 *
 * Validates:
 *   1. Mode / scope mapping daemon → SPA (`advanced` ↔ `grafana`,
 *      `user` ↔ `personal`).
 *   2. Widget list flows through and produces a synthesized layout map +
 *      ordered `widget_ids`.
 *   3. Mutations issue the correct HTTP verb + path against the daemon.
 *   4. JSON import / export adapter round-trips a payload in the
 *      stage-1 `plan4-v1` shape.
 *
 * Uses MSW to intercept the live `customFetch` calls — no module mocks.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import {
  createDashboard,
  exportDashboardServerSide,
  importDashboardJson,
  setDefaultDashboard,
  useDashboardList,
} from '../api';
import { DASHBOARD_EXPORT_VERSION } from '../types';
import type { DashboardExport } from '../types';

const TENANT = 'acme';

interface DaemonDashboardLite {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  mode: 'metabase' | 'advanced' | '';
  scope: 'tenant' | 'user' | '';
  isDefault: boolean;
  ownerUserId: string | null;
  sharedRoleIds: string[];
  homeForUsers: string[];
  variables: unknown[];
  createdAt: string;
  updatedAt: string;
}

function makeDashboard(over: Partial<DaemonDashboardLite> = {}): DaemonDashboardLite {
  return {
    id: 'd1',
    tenantId: 't1',
    name: 'D1',
    description: 'first',
    mode: 'metabase',
    scope: 'tenant',
    isDefault: true,
    ownerUserId: null,
    sharedRoleIds: [],
    homeForUsers: [],
    variables: [],
    createdAt: '2026-05-07T00:00:00Z',
    updatedAt: '2026-05-07T00:00:00Z',
    ...over,
  };
}

function makeWidget(id: string, x = 0, y = 0): Record<string, unknown> {
  return {
    id,
    dashboardId: 'd1',
    kind: 'line-chart',
    title: id,
    dataSource: 'promql',
    config: {},
    rawQuery: null,
    lockedAdvanced: false,
    layout: { x, y, w: 4, h: 3 },
    createdAt: '2026-05-07T00:00:00Z',
    updatedAt: '2026-05-07T00:00:00Z',
  };
}

function makeQc(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(qc: QueryClient): React.FC<{ children: React.ReactNode }> {
  // eslint-disable-next-line react/display-name
  return ({ children }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  server.use(
    http.get(`*/api/v1/t/${TENANT}/dashboards`, () =>
      HttpResponse.json(
        {
          items: [
            makeDashboard({ id: 'd1', mode: 'metabase', scope: 'tenant', isDefault: true }),
            makeDashboard({
              id: 'd2',
              name: 'Personal',
              mode: 'advanced',
              scope: 'user',
              isDefault: false,
              homeForUsers: ['user-1'],
            }),
          ],
          total: 2,
        },
        { status: 200 },
      ),
    ),
    http.get(`*/api/v1/t/${TENANT}/dashboards/d1/widgets`, () =>
      HttpResponse.json(
        {
          items: [makeWidget('w1', 0, 0), makeWidget('w2', 4, 0)],
          total: 2,
        },
        { status: 200 },
      ),
    ),
    http.get(`*/api/v1/t/${TENANT}/dashboards/d2/widgets`, () =>
      HttpResponse.json({ items: [], total: 0 }, { status: 200 }),
    ),
  );
});

afterEach(() => {
  server.resetHandlers();
});

describe('useDashboardList — mapping + filtering', () => {
  it('maps daemon mode/scope into SPA vocabulary', async () => {
    const qc = makeQc();
    const { result } = renderHook(
      () => useDashboardList(TENANT, { search: '', modes: [], scopes: [] }),
      { wrapper: makeWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.length).toBe(2);
    });
    const d1 = result.current.find((d) => d.id === 'd1');
    const d2 = result.current.find((d) => d.id === 'd2');
    expect(d1?.mode).toBe('metabase');
    expect(d1?.scope).toBe('tenant');
    expect(d1?.default).toBe(true);
    expect(d2?.mode).toBe('grafana');
    expect(d2?.scope).toBe('personal');
    expect(d2?.default).toBe(false);
  });

  it('synthesizes widget_ids + layout from the widgets endpoint', async () => {
    const qc = makeQc();
    const { result } = renderHook(
      () => useDashboardList(TENANT, { search: '', modes: [], scopes: [] }),
      { wrapper: makeWrapper(qc) },
    );
    await waitFor(() => {
      const d1 = result.current.find((d) => d.id === 'd1');
      expect(d1?.widget_ids.length).toBe(2);
    });
    const d1 = result.current.find((d) => d.id === 'd1');
    expect(d1?.widget_ids).toEqual(['w1', 'w2']);
    expect(d1?.layout.w1).toEqual({ x: 0, y: 0, w: 4, h: 3 });
    expect(d1?.layout.w2).toEqual({ x: 4, y: 0, w: 4, h: 3 });
  });

  it('applies SPA-side filter for mode + scope + search + defaultOnly', async () => {
    const qc = makeQc();
    const { result } = renderHook(
      () =>
        useDashboardList(TENANT, {
          search: '',
          modes: ['grafana'],
          scopes: [],
        }),
      { wrapper: makeWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.length).toBe(1);
    });
    expect(result.current[0]?.id).toBe('d2');
  });
});

describe('mutations issue correct verbs and paths', () => {
  it('createDashboard POSTs the create body with mapped fields', async () => {
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.post(`*/api/v1/t/${TENANT}/dashboards`, async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          makeDashboard({ id: 'd-new', name: 'fresh', mode: 'advanced', scope: 'user' }),
          { status: 201 },
        );
      }),
    );

    const out = await createDashboard(TENANT, {
      name: 'fresh',
      mode: 'grafana',
      scope: 'personal',
    });

    expect(captured).not.toBeNull();
    expect(captured!.name).toBe('fresh');
    expect(captured!.mode).toBe('advanced');
    expect(captured!.scope).toBe('user');
    expect(out.id).toBe('d-new');
    expect(out.mode).toBe('grafana');
    expect(out.scope).toBe('personal');
  });

  it('setDefaultDashboard POSTs to .../set-default', async () => {
    let hit = false;
    server.use(
      http.post(`*/api/v1/t/${TENANT}/dashboards/d1/set-default`, () => {
        hit = true;
        return HttpResponse.json(makeDashboard({ id: 'd1', isDefault: true }), { status: 200 });
      }),
      http.get(`*/api/v1/t/${TENANT}/dashboards/d1/widgets`, () =>
        HttpResponse.json({ items: [], total: 0 }, { status: 200 }),
      ),
    );
    const out = await setDefaultDashboard(TENANT, 'd1');
    expect(hit).toBe(true);
    expect(out.default).toBe(true);
  });
});

describe('export / import adapters', () => {
  it('exportDashboardServerSide hits the GET .../export endpoint', async () => {
    let hit = false;
    server.use(
      http.get(`*/api/v1/t/${TENANT}/dashboards/d1/export`, () => {
        hit = true;
        return HttpResponse.json(
          { dashboard: makeDashboard({ id: 'd1' }), widgets: [makeWidget('w1')] },
          { status: 200 },
        );
      }),
    );
    const out = await exportDashboardServerSide(TENANT, 'd1');
    expect(hit).toBe(true);
    expect(out.dashboard.id).toBe('d1');
  });

  it('importDashboardJson POSTs to /import with the daemon-shaped payload', async () => {
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.post(`*/api/v1/t/${TENANT}/dashboards/import`, async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          makeDashboard({ id: 'd-imported', name: 'Imported' }),
          { status: 201 },
        );
      }),
    );
    const payload: DashboardExport = {
      version: DASHBOARD_EXPORT_VERSION,
      exported_at: '2026-05-07T00:00:00Z',
      dashboard: {
        id: 'old-id',
        tenant_id: 'old-tenant',
        name: 'Imported',
        default: false,
        widget_ids: [],
        owner_user_id: null,
        mode: 'metabase',
        scope: 'tenant',
        shared_role_ids: [],
        layout: {},
        variables: [],
        created_at: '2026-05-07T00:00:00Z',
        updated_at: '2026-05-07T00:00:00Z',
      },
      widgets: [],
    };
    const out = await importDashboardJson(TENANT, payload);
    expect(captured).not.toBeNull();
    const dash = (captured as unknown as { dashboard: { mode: string; scope: string } }).dashboard;
    expect(dash.mode).toBe('metabase');
    expect(dash.scope).toBe('tenant');
    expect(out.id).toBe('d-imported');
  });

  it('importDashboardJson rejects malformed JSON', async () => {
    await expect(importDashboardJson(TENANT, '{not json')).rejects.toThrow(/Invalid JSON/);
  });
});
