/**
 * Tests for the policies feature barrel (re-exports + attached helper).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  usePolicyList,
  usePolicyDetail,
  createPolicy,
  updatePolicy,
  deletePolicy,
  usePoliciesAttachedToRoute,
} from '..';

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

  it('usePolicyList returns seeded access policies', () => {
    const { result } = renderHook(() => usePolicyList());
    expect(result.current.length).toBeGreaterThan(0);
  });

  it('usePolicyDetail returns a policy by id', () => {
    const policy = Object.values(useMockStore.getState().accessPolicies)[0];
    if (!policy) throw new Error('no policy');
    const { result } = renderHook(() => usePolicyDetail(policy.id));
    expect(result.current?.id).toBe(policy.id);
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

    // attachPolicy now requires tenantId because the daemon endpoint is
    // tenant-scoped. This test covers `usePoliciesAttachedToRoute` which
    // still reads from the mock store, so we mutate the store directly to
    // simulate the post-attach state without round-tripping through the
    // real (Stage-2) HTTP path.
    useMockStore.setState((s) => ({
      routes: {
        ...s.routes,
        [route.id]: {
          ...route,
          policies: route.policies.includes(policy.id)
            ? route.policies
            : [...route.policies, policy.id],
        },
      },
    }));

    const { result } = renderHook(() => usePoliciesAttachedToRoute(route.id));
    expect(result.current.some((p) => p.id === policy.id)).toBe(true);
  });

  it('returns empty array when routeId is unknown', () => {
    const { result } = renderHook(() => usePoliciesAttachedToRoute('no-such-route'));
    expect(result.current).toEqual([]);
  });
});
