/**
 * Real-API tests for the access-policies slice.
 *
 * These tests deliberately bypass the mock-store layer: they wire the
 * Orval-generated hooks via MSW so the production code path under
 * stage-2 (`VITE_USE_MOCKS=false`) is the one being exercised.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';

import { server } from '@/test/msw-server';
import {
  useAccessPolicyList,
  createAccessPolicyMutation,
  updateAccessPolicyMutation,
  deleteAccessPolicyMutation,
  testAccessPolicyCelMutation,
} from '../api';

const TENANT = 'acme';

function wrap() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return QueryWrapper;
}

interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

function captureRequest(
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  pathPattern: string,
  responseFactory: () => Response | Promise<Response>,
): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  server.use(
    http[method](pathPattern, async ({ request }) => {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        body = undefined;
      }
      recorded.push({ method: request.method, url: request.url, body });
      return responseFactory();
    }),
  );
  return recorded;
}

// ─── list ──────────────────────────────────────────────────────────────────────

describe('useAccessPolicyList', () => {
  it('renders the policies returned by the daemon', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/access-policies`, () =>
        HttpResponse.json({
          accessPolicies: [
            {
              id: 'pol-1',
              tenantId: TENANT,
              name: 'block-internal',
              expression: 'request.method == "DELETE"',
              effect: 'deny',
              priority: 10,
              enabled: true,
              createdAt: '2026-04-01T00:00:00Z',
            },
            {
              id: 'pol-2',
              tenantId: TENANT,
              name: 'allow-readers',
              expression: 'true',
              effect: 'allow',
              priority: 100,
              enabled: false,
              createdAt: '2026-04-02T00:00:00Z',
            },
          ],
        }),
      ),
    );

    const { result } = renderHook(() => useAccessPolicyList(TENANT), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data[0]).toMatchObject({
      id: 'pol-1',
      tenant_id: TENANT,
      name: 'block-internal',
      condition: 'request.method == "DELETE"',
      action: 'deny',
      priority: 10,
      enabled: true,
    });
    expect(result.current.data[1]).toMatchObject({
      id: 'pol-2',
      action: 'allow',
      enabled: false,
    });
  });

  it('surfaces fetch errors', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/access-policies`, () =>
        HttpResponse.json({ title: 'boom' }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useAccessPolicyList(TENANT), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.data).toEqual([]);
  });
});

// ─── create / update / delete ──────────────────────────────────────────────────

describe('createAccessPolicyMutation', () => {
  it('POSTs the wire payload (expression/effect, not condition/action)', async () => {
    const recorded = captureRequest('post', `*/api/v1/t/${TENANT}/access-policies`, () =>
      HttpResponse.json(null, { status: 201 }),
    );

    await createAccessPolicyMutation(TENANT, {
      name: 'new-policy',
      condition: 'request.method == "GET"',
      action: 'allow',
      priority: 50,
      enabled: true,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.method).toBe('POST');
    expect(recorded[0]?.url).toContain(`/api/v1/t/${TENANT}/access-policies`);
    expect(recorded[0]?.body).toMatchObject({
      name: 'new-policy',
      expression: 'request.method == "GET"',
      effect: 'allow',
      priority: 50,
      enabled: true,
    });
  });
});

describe('updateAccessPolicyMutation', () => {
  it('PATCHes the wire payload (merge-patch)', async () => {
    const recorded = captureRequest('patch', `*/api/v1/t/${TENANT}/access-policies/pol-1`, () =>
      HttpResponse.json(null, { status: 200 }),
    );

    await updateAccessPolicyMutation(TENANT, 'pol-1', {
      enabled: false,
      priority: 200,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.method).toBe('PATCH');
    expect(recorded[0]?.body).toMatchObject({ enabled: false, priority: 200 });
    const body = recorded[0]?.body as Record<string, unknown>;
    expect(body.name).toBeUndefined();
    expect(body.expression).toBeUndefined();
  });
});

describe('deleteAccessPolicyMutation', () => {
  it('issues DELETE against the canonical resource path', async () => {
    const recorded = captureRequest('delete', `*/api/v1/t/${TENANT}/access-policies/pol-1`, () =>
      HttpResponse.json(null, { status: 204 }),
    );

    await deleteAccessPolicyMutation(TENANT, 'pol-1');

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.method).toBe('DELETE');
  });
});

// ─── test-cel ──────────────────────────────────────────────────────────────────

describe('testAccessPolicyCelMutation', () => {
  it('returns matched=true on a matching expression', async () => {
    const recorded = captureRequest('post', `*/api/v1/t/${TENANT}/access-policies/test-cel`, () =>
      HttpResponse.json({
        matched: true,
        durationMs: 0.42,
      }),
    );

    const result = await testAccessPolicyCelMutation(TENANT, {
      expr: 'request.method == "GET"',
      sample: { request: { method: 'GET' } },
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.body).toMatchObject({
      expr: 'request.method == "GET"',
      sample: { request: { method: 'GET' } },
    });
    expect(result.matched).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns matched=false with an error string for an invalid expression', async () => {
    server.use(
      http.post(`*/api/v1/t/${TENANT}/access-policies/test-cel`, () =>
        HttpResponse.json({
          matched: false,
          durationMs: 0.12,
          error: 'ERROR: <input>:1:1: Syntax error: unexpected token',
        }),
      ),
    );

    const result = await testAccessPolicyCelMutation(TENANT, {
      expr: 'request.method ==',
      sample: { request: { method: 'GET' } },
    });

    expect(result.matched).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Syntax error');
  });
});

// ─── E2E: create → list cache invalidation ─────────────────────────────────────

describe('cache invalidation on mutate', () => {
  it('refetches the list after a successful create', async () => {
    let listCalls = 0;
    server.use(
      http.get(`*/api/v1/t/${TENANT}/access-policies`, () => {
        listCalls += 1;
        return HttpResponse.json({ accessPolicies: [] });
      }),
      http.post(`*/api/v1/t/${TENANT}/access-policies`, () =>
        HttpResponse.json(null, { status: 201 }),
      ),
    );

    const { useCreateAccessPolicyMutation } = await import('../api');
    const Wrapper = wrap();
    const { result } = renderHook(
      () => ({
        list: useAccessPolicyList(TENANT),
        create: useCreateAccessPolicyMutation(TENANT),
      }),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.list.isLoading).toBe(false);
    });
    const initial = listCalls;

    await act(async () => {
      await result.current.create({
        name: 'fresh',
        condition: 'true',
        action: 'allow',
        priority: 100,
        enabled: true,
      });
    });

    await waitFor(() => {
      expect(listCalls).toBeGreaterThan(initial);
    });
  });
});
