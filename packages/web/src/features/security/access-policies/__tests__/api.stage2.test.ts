/**
 * Integration tests for features/security/access-policies/api.stage2.ts
 *
 * Covers list/detail/create/update/delete plus the `useTestCEL` hook that
 * POSTs to /access-policies/test-cel.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import type {
  AccessPolicy as ProtoAccessPolicy,
  ListAccessPolicies200,
  TestCELResult,
} from '@/api/generated/schemas';
import {
  useAccessPolicyListReal,
  useAccessPolicyReal,
  useCreateAccessPolicyMutation,
  useUpdateAccessPolicyMutation,
  useDeleteAccessPolicyMutation,
  useTestCEL,
} from '../api.stage2';
import {
  fromProtoAccessPolicy,
  toProtoAccessPolicyCreate,
  toProtoAccessPolicyPatch,
} from '../adapter';

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

function makeProtoPolicy(overrides: Partial<ProtoAccessPolicy> = {}): ProtoAccessPolicy {
  return {
    id: 'pol-1',
    tenantId: TENANT,
    name: 'allow-admins',
    description: '',
    expression: 'user.role == "admin"',
    effect: 'allow',
    priority: 10,
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('useAccessPolicyListReal', () => {
  it('lists policies and adapts the wire shape', async () => {
    const policies = [
      makeProtoPolicy({ id: 'pol-a', name: 'a' }),
      makeProtoPolicy({ id: 'pol-b', name: 'b', effect: 'deny' }),
    ];
    server.use(
      http.get(`*/api/v1/t/${TENANT}/access-policies`, () =>
        HttpResponse.json({ accessPolicies: policies } as ListAccessPolicies200),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useAccessPolicyListReal(TENANT), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.policies).toHaveLength(2);
    expect(result.current.policies[0]?.action).toBe('allow');
    expect(result.current.policies[1]?.action).toBe('deny');
    expect(result.current.policies[0]?.condition).toBe('user.role == "admin"');
  });
});

describe('useAccessPolicyReal', () => {
  it('fetches a single policy', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/access-policies/pol-x`, () =>
        HttpResponse.json(makeProtoPolicy({ id: 'pol-x', name: 'detail' })),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useAccessPolicyReal(TENANT, 'pol-x'), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => {
      expect(result.current?.id).toBe('pol-x');
    });
  });
});

describe('mutation hooks', () => {
  it('create posts the wire body and adapts the response', async () => {
    let captured: unknown = undefined;
    const created = makeProtoPolicy({ id: 'pol-new', name: 'new' });
    server.use(
      http.post(`*/api/v1/t/${TENANT}/access-policies`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useCreateAccessPolicyMutation(TENANT), {
      wrapper: makeWrapper(qc),
    });
    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({
        name: 'new',
        condition: 'true',
        action: 'deny',
        priority: 5,
        enabled: true,
      });
    });
    expect(captured).toMatchObject({
      name: 'new',
      expression: 'true',
      effect: 'deny',
      priority: 5,
    });
    expect(returned).toMatchObject({ id: 'pol-new', action: 'allow' });
  });

  it('update PATCHes the policy', async () => {
    let patchBody: unknown = undefined;
    server.use(
      http.patch(`*/api/v1/t/${TENANT}/access-policies/pol-u`, async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json(makeProtoPolicy({ id: 'pol-u', enabled: false }));
      }),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useUpdateAccessPolicyMutation(TENANT), {
      wrapper: makeWrapper(qc),
    });
    await act(async () => {
      await result.current.mutateAsync({
        id: 'pol-u',
        payload: { enabled: false, action: 'deny' },
      });
    });
    expect(patchBody).toMatchObject({ enabled: false, effect: 'deny' });
  });

  it('delete sends a DELETE', async () => {
    let called = false;
    server.use(
      http.delete(`*/api/v1/t/${TENANT}/access-policies/pol-d`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useDeleteAccessPolicyMutation(TENANT), {
      wrapper: makeWrapper(qc),
    });
    await act(async () => {
      await result.current.mutateAsync('pol-d');
    });
    expect(called).toBe(true);
  });
});

describe('useTestCEL', () => {
  it('POSTs the expression + sample and returns the matched/error/durationMs result', async () => {
    let captured: unknown = undefined;
    const fakeResult: TestCELResult = { matched: true, durationMs: 0.42 };
    server.use(
      http.post(`*/api/v1/t/${TENANT}/access-policies/test-cel`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(fakeResult);
      }),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useTestCEL(TENANT), {
      wrapper: makeWrapper(qc),
    });
    let returned: TestCELResult | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({
        expr: 'user.role == "admin"',
        sample: { user: { role: 'admin' } },
      });
    });
    expect(captured).toEqual({
      expr: 'user.role == "admin"',
      sample: { user: { role: 'admin' } },
    });
    expect(returned?.matched).toBe(true);
    expect(returned?.durationMs).toBe(0.42);
  });

  it('surfaces error field from the daemon response', async () => {
    server.use(
      http.post(`*/api/v1/t/${TENANT}/access-policies/test-cel`, () =>
        HttpResponse.json({
          matched: false,
          error: 'unrecognized token: "@"',
          durationMs: 0.1,
        } as TestCELResult),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useTestCEL(TENANT), {
      wrapper: makeWrapper(qc),
    });
    let returned: TestCELResult | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ expr: '@@@' });
    });
    expect(returned?.matched).toBe(false);
    expect(returned?.error).toContain('unrecognized');
  });
});

describe('adapter', () => {
  it('fromProtoAccessPolicy maps fields', () => {
    const p = fromProtoAccessPolicy(makeProtoPolicy(), TENANT);
    expect(p.condition).toBe('user.role == "admin"');
    expect(p.action).toBe('allow');
    expect(p.priority).toBe(10);
  });

  it('toProtoAccessPolicyCreate uses expression key', () => {
    const body = toProtoAccessPolicyCreate({
      name: 'n',
      condition: 'true',
      action: 'allow',
      priority: 1,
      enabled: true,
    });
    expect(body.expression).toBe('true');
    expect(body.effect).toBe('allow');
  });

  it('toProtoAccessPolicyPatch only emits provided keys', () => {
    const body = toProtoAccessPolicyPatch({ enabled: false });
    expect(body).toEqual({ enabled: false });
  });
});
