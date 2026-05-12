/**
 * Integration tests for features/middlewares/api.stage2.ts
 *
 * Uses MSW (backed by the Orval-generated handlers from msw-server.ts) plus
 * per-test overrides to validate that the Stage 2 hooks call the right
 * endpoints, adapt the wire shape to admin Middleware, and apply the
 * client-side filter + sort.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import type { ListMiddlewares200, Middleware as ProtoMiddleware } from '@/api/generated/schemas';
import {
  useMiddlewareListReal,
  useMiddlewareDetailReal,
  useCreateMiddlewareMutation,
  useUpdateMiddlewareMutation,
  useDeleteMiddlewareMutation,
} from '../api.stage2';
import { fromProtoMiddleware, toProtoMiddlewareCreate } from '../adapter';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

const TENANT = 'test-tenant';

function makeProtoMiddleware(overrides: Partial<ProtoMiddleware> = {}): ProtoMiddleware {
  return {
    id: 'mw-1',
    tenantId: TENANT,
    name: 'rate-limiter',
    kind: 'rate-limit',
    config: { rps: 100 },
    enabled: true,
    orderHint: 50,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('useMiddlewareListReal', () => {
  it('lists middlewares from the daemon and adapts the shape', async () => {
    const items: ProtoMiddleware[] = [
      makeProtoMiddleware({ id: 'mw-a', name: 'a', orderHint: 200 }),
      makeProtoMiddleware({ id: 'mw-b', name: 'b', orderHint: 100 }),
    ];
    const body: ListMiddlewares200 = { items, total: 2 };
    server.use(http.get(`*/api/v1/t/${TENANT}/middlewares`, () => HttpResponse.json(body)));

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useMiddlewareListReal(TENANT, { search: '', kind: 'all', enabled: 'all' }),
      { wrapper: makeWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.middlewares).toHaveLength(2);
    expect(result.current.middlewares[0]?.id).toBe('mw-b');
    expect(result.current.middlewares[1]?.id).toBe('mw-a');
    expect(result.current.middlewares[0]?.kind).toBe('rate-limit');
    expect(result.current.middlewares[0]?.tenant_id).toBe(TENANT);
  });

  it('applies the kind filter client-side', async () => {
    const items: ProtoMiddleware[] = [
      makeProtoMiddleware({ id: 'mw-r', kind: 'rate-limit' }),
      makeProtoMiddleware({ id: 'mw-c', kind: 'cors' }),
    ];
    server.use(
      http.get(`*/api/v1/t/${TENANT}/middlewares`, () =>
        HttpResponse.json({ items, total: 2 } as ListMiddlewares200),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(
      () => useMiddlewareListReal(TENANT, { search: '', kind: 'rate-limit', enabled: 'all' }),
      { wrapper: makeWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.middlewares.map((m) => m.id)).toEqual(['mw-r']);
  });
});

describe('useMiddlewareDetailReal', () => {
  it('fetches a single middleware', async () => {
    const proto = makeProtoMiddleware({ id: 'mw-x', name: 'detail-test' });
    server.use(http.get(`*/api/v1/t/${TENANT}/middlewares/mw-x`, () => HttpResponse.json(proto)));
    const qc = makeQueryClient();
    const { result } = renderHook(() => useMiddlewareDetailReal(TENANT, 'mw-x'), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => {
      expect(result.current?.id).toBe('mw-x');
    });
    expect(result.current?.name).toBe('detail-test');
  });
});

describe('mutation hooks', () => {
  it('create posts the adapted body and returns the adapted result', async () => {
    let captured: unknown = undefined;
    const created = makeProtoMiddleware({ id: 'mw-new', name: 'new-mw' });
    server.use(
      http.post(`*/api/v1/t/${TENANT}/middlewares`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useCreateMiddlewareMutation(TENANT), {
      wrapper: makeWrapper(qc),
    });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({
        name: 'new-mw',
        kind: 'cors',
        config: { allowedOrigins: ['*'] },
      });
    });

    expect(captured).toMatchObject({ name: 'new-mw', kind: 'cors', orderHint: 100 });
    expect(returned).toMatchObject({ id: 'mw-new', name: 'new-mw', tenant_id: TENANT });
  });

  it('update sends a PATCH', async () => {
    let patchCalled = false;
    const patched = makeProtoMiddleware({ id: 'mw-u', name: 'updated' });
    server.use(
      http.patch(`*/api/v1/t/${TENANT}/middlewares/mw-u`, () => {
        patchCalled = true;
        return HttpResponse.json(patched);
      }),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useUpdateMiddlewareMutation(TENANT), {
      wrapper: makeWrapper(qc),
    });
    await act(async () => {
      await result.current.mutateAsync({
        id: 'mw-u',
        input: { name: 'updated' },
      });
    });
    expect(patchCalled).toBe(true);
  });

  it('delete sends a DELETE', async () => {
    let deleteCalled = false;
    server.use(
      http.delete(`*/api/v1/t/${TENANT}/middlewares/mw-d`, () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useDeleteMiddlewareMutation(TENANT), {
      wrapper: makeWrapper(qc),
    });
    await act(async () => {
      await result.current.mutateAsync('mw-d');
    });
    expect(deleteCalled).toBe(true);
  });
});

describe('adapter round-trips', () => {
  it('fromProtoMiddleware preserves required fields', () => {
    const proto = makeProtoMiddleware();
    const m = fromProtoMiddleware(proto, TENANT);
    expect(m.id).toBe('mw-1');
    expect(m.tenant_id).toBe(TENANT);
    expect(m.kind).toBe('rate-limit');
    expect(m.order_hint).toBe(50);
  });

  it('toProtoMiddlewareCreate emits camelCase', () => {
    const body = toProtoMiddlewareCreate({
      name: 'a',
      kind: 'auth',
      config: {},
      order_hint: 5,
    });
    expect(body.orderHint).toBe(5);
    expect(body.kind).toBe('auth');
  });
});
