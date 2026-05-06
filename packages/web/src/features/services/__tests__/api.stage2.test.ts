/**
 * Integration tests for features/services/api.stage2.ts
 *
 * Uses MSW (Mock Service Worker) backed by the Orval-generated handlers.
 * These tests verify that the Stage 2 Orval-wired service hooks:
 *   - list services via GET /api/v1/t/{tenant}/services
 *   - create services via POST /api/v1/t/{tenant}/services
 *   - delete services via DELETE /api/v1/t/{tenant}/services/{id}
 *   - force-reload via POST /api/v1/t/{tenant}/services/{id}/force-reload
 *
 * Adapter bridging (V1Service ↔ admin Service) is tested separately in
 * adapter.test.ts. Here we validate the end-to-end hook + adapter integration.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import type { ListServices200, V1Service } from '@/api/generated/schemas';
import type { Service } from '@/api/resources';
import {
  useServiceListReal,
  useServiceDetailReal,
  useCreateServiceMutation,
  useDeleteServiceMutation,
  useUpdateServiceMutation,
  useForceReloadServiceMutation,
} from '../api.stage2';
import { LBL_ENV, LBL_TAGS, LBL_PROTOCOL } from '../adapter';

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

/** Minimal V1Service fixture with admin labels. */
function makeV1Service(overrides: Partial<V1Service> = {}): V1Service {
  return {
    id: 'svc-fixture-1',
    name: 'fixture-api',
    upstreams: [{ address: 'http://backend:8080', healthy: true }],
    labels: {
      labels: {
        [LBL_ENV]: 'production',
        [LBL_TAGS]: 'tag-a,tag-b',
        [LBL_PROTOCOL]: 'http',
      },
    },
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ─── useServiceListReal ───────────────────────────────────────────────────────

describe('useServiceListReal', () => {
  it('returns an empty list when the daemon returns no items', async () => {
    const response: ListServices200 = { items: [], total: 0 };
    server.use(
      http.get(`*/api/v1/t/${TENANT}/services`, () =>
        HttpResponse.json(response),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () =>
        useServiceListReal(TENANT, { search: '', health: [], env: [], tags: [] }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current.isLoading).toBe(false); });
    expect(result.current.services).toHaveLength(0);
    expect(result.current.isError).toBe(false);
  });

  it('adapts V1Service items to admin Service type', async () => {
    const proto = makeV1Service();
    const response: ListServices200 = { items: [proto], total: 1 };
    server.use(
      http.get(`*/api/v1/t/${TENANT}/services`, () =>
        HttpResponse.json(response),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () =>
        useServiceListReal(TENANT, { search: '', health: [], env: [], tags: [] }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current.services).toHaveLength(1); });
    const svc = result.current.services[0];
    expect(svc).toBeDefined();
    expect(svc!.id).toBe('svc-fixture-1');
    expect(svc!.name).toBe('fixture-api');
    expect(svc!.upstream).toBe('http://backend:8080');
    expect(svc!.env).toBe('production');
    expect(svc!.tags).toEqual(['tag-a', 'tag-b']);
    expect(svc!.health).toBe('healthy');
    expect(svc!.tenant_id).toBe(TENANT);
  });

  it('filters by health status client-side', async () => {
    const healthy = makeV1Service({ id: 's1', upstreams: [{ address: 'h:80', healthy: true }] });
    const unhealthy = makeV1Service({ id: 's2', upstreams: [{ address: 'h:81', healthy: false }] });
    const response: ListServices200 = { items: [healthy, unhealthy], total: 2 };
    server.use(
      http.get(`*/api/v1/t/${TENANT}/services`, () =>
        HttpResponse.json(response),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () =>
        useServiceListReal(TENANT, { search: '', health: ['healthy'], env: [], tags: [] }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current.isLoading).toBe(false); });
    expect(result.current.services).toHaveLength(1);
    expect(result.current.services[0]!.id).toBe('s1');
  });

  it('filters by search string client-side', async () => {
    const matchSvc = makeV1Service({ id: 's1', name: 'payments-api' });
    const noMatchSvc = makeV1Service({ id: 's2', name: 'auth-service' });
    const response: ListServices200 = { items: [matchSvc, noMatchSvc], total: 2 };
    server.use(
      http.get(`*/api/v1/t/${TENANT}/services`, () =>
        HttpResponse.json(response),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () =>
        useServiceListReal(TENANT, { search: 'payments', health: [], env: [], tags: [] }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current.isLoading).toBe(false); });
    expect(result.current.services).toHaveLength(1);
    expect(result.current.services[0]!.name).toBe('payments-api');
  });

  it('reports isError on network failure', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/services`, () =>
        HttpResponse.error(),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () =>
        useServiceListReal(TENANT, { search: '', health: [], env: [], tags: [] }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });
});

// ─── useServiceDetailReal ─────────────────────────────────────────────────────

describe('useServiceDetailReal', () => {
  it('returns undefined while loading', () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/services/svc-1`, () =>
        HttpResponse.json(makeV1Service()),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useServiceDetailReal(TENANT, 'svc-1'),
      { wrapper: makeWrapper(qc) },
    );
    // Initially undefined
    expect(result.current).toBeUndefined();
  });

  it('returns adapted service once loaded', async () => {
    const proto = makeV1Service({ id: 'svc-detail-1', name: 'detail-api' });
    server.use(
      http.get(`*/api/v1/t/${TENANT}/services/svc-detail-1`, () =>
        HttpResponse.json(proto),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useServiceDetailReal(TENANT, 'svc-detail-1'),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => { expect(result.current).toBeDefined(); });
    expect(result.current!.id).toBe('svc-detail-1');
    expect(result.current!.name).toBe('detail-api');
  });
});

// ─── useCreateServiceMutation ─────────────────────────────────────────────────

describe('useCreateServiceMutation', () => {
  it('posts to the daemon and returns adapted service', async () => {
    // customFetch returns JSON body directly (the proto service, not wrapped)
    const created = makeV1Service({ id: 'svc-new-1', name: 'new-api' });
    server.use(
      http.post(`*/api/v1/t/${TENANT}/services`, () =>
        HttpResponse.json(created, { status: 201 }),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useCreateServiceMutation(TENANT),
      { wrapper: makeWrapper(qc) },
    );

    let service: Service | undefined;
    await act(async () => {
      service = await result.current.mutateAsync({
        name: 'new-api',
        upstream: 'http://backend:8080',
        upstream_protocol: 'http',
        env: 'production',
        tags: [],
      });
    });

    expect(service!.id).toBe('svc-new-1');
    expect(service!.name).toBe('new-api');
    expect(service!.tenant_id).toBe(TENANT);
  });
});

// ─── useDeleteServiceMutation ─────────────────────────────────────────────────

describe('useDeleteServiceMutation', () => {
  it('calls DELETE endpoint and resolves on success', async () => {
    server.use(
      http.delete(`*/api/v1/t/${TENANT}/services/svc-del-1`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useDeleteServiceMutation(TENANT),
      { wrapper: makeWrapper(qc) },
    );

    await act(async () => {
      await result.current.mutateAsync('svc-del-1');
    });

    expect(result.current.isSuccess).toBe(true);
  });
});

// ─── useUpdateServiceMutation ─────────────────────────────────────────────────

describe('useUpdateServiceMutation', () => {
  it('calls PATCH endpoint and returns adapted service', async () => {
    const updated = makeV1Service({ id: 'svc-u1', name: 'renamed-api' });
    server.use(
      http.patch(`*/api/v1/t/${TENANT}/services/svc-u1`, () =>
        HttpResponse.json(updated),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useUpdateServiceMutation(TENANT),
      { wrapper: makeWrapper(qc) },
    );

    let service: Service | undefined;
    await act(async () => {
      service = await result.current.mutateAsync({
        id: 'svc-u1',
        input: { name: 'renamed-api' },
      });
    });

    expect(service!.name).toBe('renamed-api');
  });
});

// ─── useForceReloadServiceMutation ────────────────────────────────────────────

describe('useForceReloadServiceMutation', () => {
  it('calls force-reload endpoint and resolves', async () => {
    server.use(
      http.post(`*/api/v1/t/${TENANT}/services/svc-fr-1/force-reload`, () =>
        new HttpResponse(null, { status: 200 }),
      ),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useForceReloadServiceMutation(TENANT),
      { wrapper: makeWrapper(qc) },
    );

    await act(async () => {
      await result.current.mutateAsync('svc-fr-1');
    });

    expect(result.current.isSuccess).toBe(true);
  });
});
