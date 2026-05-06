/**
 * Tests for the policies feature barrel (re-exports + attached helper).
 *
 * Stage-2: the access-policies API has been wired to real Orval hooks
 * driven by MSW, so the list/detail tests provide MSW responses and
 * exercise the real fetch path. The attach helper still reads from the
 * mock-store because route↔policy attachment is not yet a daemon
 * surface (it lives in `route.policies[]` on the route record).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { createElement, type ReactNode } from 'react';
import { server } from '@/test/msw-server';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { attachPolicy } from '@/features/routes';
import {
  usePolicyList,
  usePolicyDetail,
  createPolicy,
  updatePolicy,
  deletePolicy,
  usePoliciesAttachedToRoute,
} from '..';

const TENANT = 'acme';

function wrap() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function QueryWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return QueryWrapper;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('policies barrel — re-exports resolve to the access-policies API', () => {
  it('exports function references for create/update/delete', () => {
    expect(typeof createPolicy).toBe('function');
    expect(typeof updatePolicy).toBe('function');
    expect(typeof deletePolicy).toBe('function');
  });

  it('usePolicyList returns policies fetched from the daemon', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/access-policies`, () =>
        HttpResponse.json({
          accessPolicies: [
            {
              id: 'pol-x',
              tenantId: TENANT,
              name: 'x',
              expression: 'true',
              effect: 'allow',
              priority: 10,
              enabled: true,
            },
          ],
        }),
      ),
    );
    const { result } = renderHook(() => usePolicyList(TENANT), { wrapper: wrap() });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data.length).toBeGreaterThan(0);
    expect(result.current.data[0]?.id).toBe('pol-x');
  });

  it('usePolicyDetail returns a policy by id', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/access-policies/pol-x`, () =>
        HttpResponse.json({
          id: 'pol-x',
          tenantId: TENANT,
          name: 'x',
          expression: 'true',
          effect: 'allow',
          priority: 10,
          enabled: true,
        }),
      ),
    );
    const { result } = renderHook(() => usePolicyDetail(TENANT, 'pol-x'), { wrapper: wrap() });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data?.id).toBe('pol-x');
  });
});

describe('usePoliciesAttachedToRoute', () => {
  it('returns empty when route has no attached policies', () => {
    const route = Object.values(useMockStore.getState().routes)[0];
    if (!route) throw new Error('no route');
    const { result } = renderHook(() => usePoliciesAttachedToRoute(route.id));
    expect(result.current).toEqual([]);
  });

  it('resolves policy records attached via route.policies', async () => {
    const route = Object.values(useMockStore.getState().routes)[0];
    if (!route) throw new Error('no route');
    const policy = Object.values(useMockStore.getState().accessPolicies)[0];
    if (!policy) throw new Error('no policy');

    await attachPolicy(route.id, policy.id);

    const { result } = renderHook(() => usePoliciesAttachedToRoute(route.id));
    expect(result.current.some((p) => p.id === policy.id)).toBe(true);
  });

  it('returns empty array when routeId is unknown', () => {
    const { result } = renderHook(() => usePoliciesAttachedToRoute('no-such-route'));
    expect(result.current).toEqual([]);
  });
});
