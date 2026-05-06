/**
 * Integration tests for features/routes/api.stage2.ts
 *
 * Uses MSW (Mock Service Worker) backed by the Orval-generated handlers.
 * These tests verify that the Stage 2 Orval-wired route hooks:
 *   - list routes via GET /api/v1/t/{tenant}/routes
 *   - get route via GET /api/v1/t/{tenant}/routes/{id}
 *   - create routes via POST /api/v1/t/{tenant}/routes
 *   - patch routes via PATCH /api/v1/t/{tenant}/routes/{id}
 *   - delete routes via DELETE /api/v1/t/{tenant}/routes/{id}
 *   - attach/detach policy via POST/DELETE .../routes/{id}/policies/{policyId}
 *   - list route policies via GET .../routes/{id}/policies
 *
 * Adapter bridging (V1Route ↔ admin Route) is tested separately in
 * adapter.test.ts. Here we validate end-to-end hook + adapter integration.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import type { V1Route } from '@/api/generated/schemas';
import type { Route } from '@/api/resources';
import { V1PathMatcherType } from '@/api/generated/schemas';
import {
  useRouteListReal,
  useRouteDetailReal,
  useCreateRouteMutation,
  useUpdateRouteMutation,
  useDeleteRouteMutation,
  useAttachPolicyMutation,
  useDetachPolicyMutation,
  useListRoutePoliciesReal,
  useReorderMiddlewaresMutation,
} from '../api.stage2';
import { LBL_MIDDLEWARE_IDS } from '../adapter';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(qc: QueryClient) {
  return function TestQueryProvider({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

const TENANT = 'test-tenant';

/** Minimal V1Route fixture with a simple GET /api/users prefix matcher. */
function makeV1Route(overrides: Partial<V1Route> = {}): V1Route {
  return {
    id: 'rt-fixture-1',
    name: 'get-users',
    serviceId: 'svc-1',
    enabled: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    policyIds: [],
    matchers: [
      {
        methods: ['GET'],
        paths: [{ type: V1PathMatcherType.TYPE_PREFIX, value: '/api/users' }],
      },
    ],
    ...overrides,
  };
}

// ─── useRouteListReal ─────────────────────────────────────────────────────────

describe('useRouteListReal', () => {
  it('returns empty list when daemon returns no items', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes`, () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useRouteListReal(TENANT, undefined),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current.isLoading).toBe(false); });
    expect(result.current.routes).toHaveLength(0);
    expect(result.current.isError).toBe(false);
  });

  it('adapts V1Route items to admin Route type', async () => {
    const proto = makeV1Route();
    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes`, () =>
        HttpResponse.json({ items: [proto], total: 1 }),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useRouteListReal(TENANT, undefined),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current.routes).toHaveLength(1); });
    const rt = result.current.routes[0];
    expect(rt).toBeDefined();
    expect(rt!.id).toBe('rt-fixture-1');
    expect(rt!.name).toBe('get-users');
    expect(rt!.service_id).toBe('svc-1');
    expect(rt!.method).toBe('GET');
    expect(rt!.path).toBe('/api/users');
    expect(rt!.match_kind).toBe('prefix');
    expect(rt!.enabled).toBe(true);
  });

  it('filters by serviceId when provided', async () => {
    const rt1 = makeV1Route({ id: 'rt-1', serviceId: 'svc-a' });
    const rt2 = makeV1Route({ id: 'rt-2', serviceId: 'svc-b' });
    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes`, () =>
        HttpResponse.json({ items: [rt1, rt2], total: 2 }),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useRouteListReal(TENANT, 'svc-a'),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current.isLoading).toBe(false); });
    expect(result.current.routes).toHaveLength(1);
    expect(result.current.routes[0]!.id).toBe('rt-1');
  });

  it('filters by method client-side', async () => {
    const getRoute = makeV1Route({ id: 'rt-get', matchers: [{ methods: ['GET'], paths: [{ type: V1PathMatcherType.TYPE_PREFIX, value: '/a' }] }] });
    const postRoute = makeV1Route({ id: 'rt-post', matchers: [{ methods: ['POST'], paths: [{ type: V1PathMatcherType.TYPE_PREFIX, value: '/b' }] }] });
    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes`, () =>
        HttpResponse.json({ items: [getRoute, postRoute], total: 2 }),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useRouteListReal(TENANT, undefined, { search: '', method: 'GET', enabled: 'all' }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current.isLoading).toBe(false); });
    expect(result.current.routes).toHaveLength(1);
    expect(result.current.routes[0]!.id).toBe('rt-get');
  });

  it('filters by search string client-side', async () => {
    const match = makeV1Route({ id: 'rt-1', name: 'payments-route' });
    const noMatch = makeV1Route({ id: 'rt-2', name: 'auth-route' });
    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes`, () =>
        HttpResponse.json({ items: [match, noMatch], total: 2 }),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useRouteListReal(TENANT, undefined, { search: 'payments', method: 'all', enabled: 'all' }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current.isLoading).toBe(false); });
    expect(result.current.routes).toHaveLength(1);
    expect(result.current.routes[0]!.name).toBe('payments-route');
  });

  it('reports isError on network failure', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes`, () => HttpResponse.error()),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useRouteListReal(TENANT, undefined),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });
});

// ─── useRouteDetailReal ───────────────────────────────────────────────────────

describe('useRouteDetailReal', () => {
  it('returns undefined while loading', () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes/rt-1`, () =>
        HttpResponse.json(makeV1Route()),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useRouteDetailReal(TENANT, 'rt-1'),
      { wrapper: makeWrapper(qc) },
    );
    expect(result.current).toBeUndefined();
  });

  it('returns adapted route once loaded', async () => {
    const proto = makeV1Route({ id: 'rt-detail-1', name: 'detail-route' });
    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes/rt-detail-1`, () =>
        HttpResponse.json(proto),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useRouteDetailReal(TENANT, 'rt-detail-1'),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current).toBeDefined(); });
    expect(result.current!.id).toBe('rt-detail-1');
    expect(result.current!.name).toBe('detail-route');
  });

  it('reads middleware_ids from label', async () => {
    const proto = makeV1Route({
      id: 'rt-mw',
      labels: { labels: { [LBL_MIDDLEWARE_IDS]: 'mw-1,mw-2' } },
    });
    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes/rt-mw`, () =>
        HttpResponse.json(proto),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useRouteDetailReal(TENANT, 'rt-mw'),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current).toBeDefined(); });
    expect(result.current!.middleware_ids).toEqual(['mw-1', 'mw-2']);
  });
});

// ─── useCreateRouteMutation ───────────────────────────────────────────────────

describe('useCreateRouteMutation', () => {
  it('posts to daemon and returns adapted route', async () => {
    const created = makeV1Route({ id: 'rt-new-1', name: 'new-route' });
    server.use(
      http.post(`*/api/v1/t/${TENANT}/routes`, () =>
        HttpResponse.json(created, { status: 201 }),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useCreateRouteMutation(TENANT),
      { wrapper: makeWrapper(qc) },
    );

    let route: Route | undefined;
    await act(async () => {
      route = await result.current.mutateAsync({
        service_id: 'svc-1',
        name: 'new-route',
        path: '/api/users',
        method: 'GET',
        match_kind: 'prefix',
      });
    });

    expect(route!.id).toBe('rt-new-1');
    expect(route!.name).toBe('new-route');
  });
});

// ─── useUpdateRouteMutation ───────────────────────────────────────────────────

describe('useUpdateRouteMutation', () => {
  it('calls PATCH endpoint and returns adapted route', async () => {
    const updated = makeV1Route({ id: 'rt-u1', name: 'renamed-route' });
    server.use(
      http.patch(`*/api/v1/t/${TENANT}/routes/rt-u1`, () =>
        HttpResponse.json(updated),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useUpdateRouteMutation(TENANT),
      { wrapper: makeWrapper(qc) },
    );

    let route: Route | undefined;
    await act(async () => {
      route = await result.current.mutateAsync({
        id: 'rt-u1',
        input: { name: 'renamed-route' },
      });
    });

    expect(route!.name).toBe('renamed-route');
  });
});

// ─── useDeleteRouteMutation ───────────────────────────────────────────────────

describe('useDeleteRouteMutation', () => {
  it('calls DELETE endpoint and resolves on success', async () => {
    server.use(
      http.delete(`*/api/v1/t/${TENANT}/routes/rt-del-1`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useDeleteRouteMutation(TENANT),
      { wrapper: makeWrapper(qc) },
    );

    await act(async () => {
      await result.current.mutateAsync('rt-del-1');
    });

    expect(result.current.isSuccess).toBe(true);
  });
});

// ─── useReorderMiddlewaresMutation ────────────────────────────────────────────

describe('useReorderMiddlewaresMutation', () => {
  it('patches route with middleware_ids label and returns adapted route', async () => {
    const patched = makeV1Route({
      id: 'rt-reorder',
      labels: { labels: { [LBL_MIDDLEWARE_IDS]: 'mw-2,mw-1' } },
    });
    server.use(
      http.patch(`*/api/v1/t/${TENANT}/routes/rt-reorder`, () =>
        HttpResponse.json(patched),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useReorderMiddlewaresMutation(TENANT),
      { wrapper: makeWrapper(qc) },
    );

    let route: Route | undefined;
    await act(async () => {
      route = await result.current.mutateAsync({
        routeId: 'rt-reorder',
        middlewareIds: ['mw-2', 'mw-1'],
      });
    });

    expect(route!.middleware_ids).toEqual(['mw-2', 'mw-1']);
  });
});

// ─── useAttachPolicyMutation / useDetachPolicyMutation ────────────────────────

describe('useAttachPolicyMutation', () => {
  it('posts to attach endpoint and resolves', async () => {
    server.use(
      http.post(`*/api/v1/t/${TENANT}/routes/rt-1/policies/pol-1`, () =>
        new HttpResponse(null, { status: 200 }),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useAttachPolicyMutation(TENANT),
      { wrapper: makeWrapper(qc) },
    );

    await act(async () => {
      await result.current.mutateAsync({ routeId: 'rt-1', policyId: 'pol-1' });
    });

    expect(result.current.isSuccess).toBe(true);
  });
});

describe('useDetachPolicyMutation', () => {
  it('calls DELETE on attach endpoint and resolves', async () => {
    server.use(
      http.delete(`*/api/v1/t/${TENANT}/routes/rt-1/policies/pol-1`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useDetachPolicyMutation(TENANT),
      { wrapper: makeWrapper(qc) },
    );

    await act(async () => {
      await result.current.mutateAsync({ routeId: 'rt-1', policyId: 'pol-1' });
    });

    expect(result.current.isSuccess).toBe(true);
  });
});

// ─── useListRoutePoliciesReal ─────────────────────────────────────────────────

describe('useListRoutePoliciesReal', () => {
  it('fetches policies list for a route', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes/rt-1/policies`, () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useListRoutePoliciesReal(TENANT, 'rt-1'),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current.isLoading).toBe(false); });
    expect(result.current.isError).toBe(false);
  });
});
