/**
 * Tests for the tenant identity resolver hook (issue #239).
 *
 * MSW intercepts /api/v1/t/:slug/identity. The hook is wrapped in a
 * QueryClientProvider so TanStack Query can run normally.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { server } from '@/test/msw-server';
import { useTenantIdentity } from './tenant-identity';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrap(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe('useTenantIdentity', () => {
  it('resolves {id, slug, name} for the requested tenant', async () => {
    server.use(
      http.get('/api/v1/t/acme/identity', () =>
        HttpResponse.json({
          id: 'tenant_acme',
          slug: 'acme',
          name: 'Acme Corp',
        }),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useTenantIdentity('acme'), { wrapper: wrap(qc) });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current?.id).toBe('tenant_acme');
    expect(result.current?.slug).toBe('acme');
    expect(result.current?.name).toBe('Acme Corp');
    expect(result.current?.parentDomain).toBeUndefined();
  });

  it('surfaces parentDomain when the daemon includes it', async () => {
    server.use(
      http.get('/api/v1/t/subby/identity', () =>
        HttpResponse.json({
          id: 'tenant_subby',
          slug: 'subby',
          name: 'Subby Co',
          parentDomain: 'example.com',
        }),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useTenantIdentity('subby'), { wrapper: wrap(qc) });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current?.parentDomain).toBe('example.com');
  });

  it('skips the request and returns undefined when slug is empty', async () => {
    let called = false;
    server.use(
      http.get('/api/v1/t/:slug/identity', () => {
        called = true;
        return HttpResponse.json({ id: 'x', slug: 'x', name: 'x' });
      }),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useTenantIdentity(null), { wrapper: wrap(qc) });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(result.current).toBeUndefined();
    expect(called).toBe(false);
  });

  it('returns undefined when the daemon responds with an error', async () => {
    server.use(
      http.get('/api/v1/t/missing/identity', () =>
        HttpResponse.json({ title: 'Not found' }, { status: 404 }),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useTenantIdentity('missing'), { wrapper: wrap(qc) });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current).toBeUndefined();
  });
});
