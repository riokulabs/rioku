/**
 * Integration tests for features/sites/api.stage2.ts
 *
 * Covers list/detail/create/update/delete/toggle hooks via MSW overrides.
 * Domain-typed delete confirmation is enforced as a UX guard inside the
 * mutation function.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import type { ListSites200, Site as ProtoSite } from '@/api/generated/schemas';
import {
  useSiteListReal,
  useSiteDetailReal,
  useCreateSiteMutation,
  useUpdateSiteMutation,
  useDeleteSiteMutation,
  useToggleSiteMutation,
} from '../api.stage2';
import { fromProtoSite, toProtoSiteCreate } from '../adapter';

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

function makeProtoSite(overrides: Partial<ProtoSite> = {}): ProtoSite {
  return {
    id: 'site-1',
    tenantId: TENANT,
    name: 'main',
    domain: 'example.com',
    tlsMode: 'auto',
    enabled: true,
    basicAuthEnabled: false,
    rateLimitPreset: 'none',
    redirectRules: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('useSiteListReal', () => {
  it('lists sites and adapts the wire shape', async () => {
    const items = [
      makeProtoSite({ id: 's-a', name: 'a', domain: 'a.example.com' }),
      makeProtoSite({ id: 's-b', name: 'b', domain: 'b.example.com', tlsMode: 'manual' }),
    ];
    server.use(
      http.get(`*/api/v1/t/${TENANT}/sites`, () =>
        HttpResponse.json({ items, total: 2 } as ListSites200),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(
      () =>
        useSiteListReal(TENANT, {
          search: '',
          tls_mode: [],
          enabled: [],
          linked_service_ids: [],
        }),
      { wrapper: makeWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.sites).toHaveLength(2);
    expect(result.current.sites[0]?.tenant_id).toBe(TENANT);
  });

  it('filters by tls_mode', async () => {
    const items = [
      makeProtoSite({ id: 's-a', tlsMode: 'auto' }),
      makeProtoSite({ id: 's-m', tlsMode: 'manual' }),
    ];
    server.use(
      http.get(`*/api/v1/t/${TENANT}/sites`, () =>
        HttpResponse.json({ items, total: 2 } as ListSites200),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(
      () =>
        useSiteListReal(TENANT, {
          search: '',
          tls_mode: ['manual'],
          enabled: [],
          linked_service_ids: [],
        }),
      { wrapper: makeWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.sites.map((s) => s.id)).toEqual(['s-m']);
  });
});

describe('useSiteDetailReal', () => {
  it('fetches a single site', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/sites/site-x`, () =>
        HttpResponse.json(makeProtoSite({ id: 'site-x' })),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useSiteDetailReal(TENANT, 'site-x'), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => {
      expect(result.current?.id).toBe('site-x');
    });
  });
});

describe('mutation hooks', () => {
  it('create posts the wizard input as wire body', async () => {
    let captured: unknown = undefined;
    server.use(
      http.post(`*/api/v1/t/${TENANT}/sites`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(makeProtoSite({ id: 'new-site' }), { status: 201 });
      }),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useCreateSiteMutation(TENANT), {
      wrapper: makeWrapper(qc),
    });
    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({
        input: {
          name: 'new',
          domain: 'new.example.com',
          upstream_mode: 'existing_service',
          upstream_service_id: 'svc-1',
          tls_mode: 'auto',
        },
        upstreamServiceId: 'svc-1',
      });
    });
    expect(captured).toMatchObject({
      name: 'new',
      domain: 'new.example.com',
      tlsMode: 'auto',
      upstreamServiceId: 'svc-1',
    });
    expect(returned).toMatchObject({ id: 'new-site' });
  });

  it('update sends a PATCH', async () => {
    let patchCalled = false;
    server.use(
      http.patch(`*/api/v1/t/${TENANT}/sites/site-u`, () => {
        patchCalled = true;
        return HttpResponse.json(makeProtoSite({ id: 'site-u', name: 'updated' }));
      }),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useUpdateSiteMutation(TENANT), {
      wrapper: makeWrapper(qc),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'site-u', input: { name: 'updated' } });
    });
    expect(patchCalled).toBe(true);
  });

  it('delete enforces domain-typed confirmation guard', async () => {
    server.use(
      http.delete(`*/api/v1/t/${TENANT}/sites/site-d`, () => new HttpResponse(null, { status: 204 })),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useDeleteSiteMutation(TENANT), {
      wrapper: makeWrapper(qc),
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          id: 'site-d',
          typedDomainConfirm: 'wrong.example.com',
          expectedDomain: 'right.example.com',
        });
      }),
    ).rejects.toThrow(/does not match/);
  });

  it('delete proceeds when confirmation matches', async () => {
    let deleteCalled = false;
    server.use(
      http.delete(`*/api/v1/t/${TENANT}/sites/site-ok`, () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useDeleteSiteMutation(TENANT), {
      wrapper: makeWrapper(qc),
    });
    await act(async () => {
      await result.current.mutateAsync({
        id: 'site-ok',
        typedDomainConfirm: 'right.example.com',
        expectedDomain: 'right.example.com',
      });
    });
    expect(deleteCalled).toBe(true);
  });

  it('toggle PATCHes the /enabled subresource', async () => {
    let body: unknown = undefined;
    server.use(
      http.patch(`*/api/v1/t/${TENANT}/sites/site-t/enabled`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useToggleSiteMutation(TENANT), {
      wrapper: makeWrapper(qc),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'site-t', enabled: false });
    });
    expect(body).toEqual({ enabled: false });
  });
});

describe('adapter', () => {
  it('fromProtoSite preserves fields', () => {
    const s = fromProtoSite(makeProtoSite({ upstreamServiceId: 'svc-9' }), TENANT);
    expect(s.upstream_service_id).toBe('svc-9');
    expect(s.tls_mode).toBe('auto');
  });

  it('toProtoSiteCreate emits camelCase', () => {
    const body = toProtoSiteCreate(
      {
        name: 'n',
        domain: 'd.com',
        upstream_mode: 'existing_service',
        tls_mode: 'manual',
        basic_auth_enabled: true,
        rate_limit_preset: 'strict',
      },
      'svc-1',
    );
    expect(body.tlsMode).toBe('manual');
    expect(body.basicAuthEnabled).toBe(true);
    expect(body.rateLimitPreset).toBe('strict');
    expect(body.upstreamServiceId).toBe('svc-1');
  });
});
