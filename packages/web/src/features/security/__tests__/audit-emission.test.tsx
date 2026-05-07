/**
 * Audit-emission tests — assert the generated mutation hooks call the
 * right daemon endpoint with the right verb. Each entity gets one
 * mutation exercised through MSW so a future request-shape regression
 * (e.g. wrong path, dropped body) breaks loudly.
 *
 * These tests deliberately bypass the mock-store layer: they wire
 * `useMutation` directly off the realApi re-exports so the production
 * code path under stage-2 (`VITE_USE_MOCKS=false`) is the one being
 * verified.
 *
 * Plan 02 / Item 02-004 partial close-out.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';

import { server } from '@/test/msw-server';
import { useCreateRole, useDeleteRole } from '@/features/security/roles/realApi';
import { useCreateUser, useSuspendUser } from '@/features/security/users/realApi';
import { useRevokeSession } from '@/features/security/sessions/realApi';
import { useCreateAPIKey, useRevokeAPIKey } from '@/features/security/api-keys/realApi';
import { useCreateAccessPolicy } from '@/features/security/access-policies/realApi';
import { useCreateRbacPolicy } from '@/features/security/rbac-policies/realApi';
import {
  useStartImpersonation,
  useEndImpersonation,
} from '@/features/security/impersonation/realApi';

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

function captureRequest(method: string, pathPattern: string, status = 200) {
  const recorded: RecordedRequest[] = [];
  server.use(
    http[method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete'](
      pathPattern,
      async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          body = undefined;
        }
        recorded.push({ method: request.method, url: request.url, body });
        return HttpResponse.json({ id: 'new-id' }, { status });
      },
    ),
  );
  return recorded;
}

describe('audit-emission — generated mutation hooks call the right daemon verb', () => {
  it('roles: useCreateRole POSTs /api/v1/t/:tenant/roles', async () => {
    const recorded = captureRequest('POST', `*/api/v1/t/${TENANT}/roles`, 201);
    const { result } = renderHook(() => useCreateRole(), { wrapper: wrap() });
    act(() => {
      result.current.mutate({ tenant: TENANT, data: { name: 'auditors' } });
    });
    await waitFor(() => { expect(recorded.length).toBe(1); });
    expect(recorded[0]?.method).toBe('POST');
    expect(recorded[0]?.url).toContain(`/api/v1/t/${TENANT}/roles`);
    expect(recorded[0]?.body).toMatchObject({ name: 'auditors' });
  });

  it('roles: useDeleteRole DELETEs /api/v1/t/:tenant/roles/:id', async () => {
    const recorded = captureRequest('DELETE', `*/api/v1/t/${TENANT}/roles/role-1`, 204);
    const { result } = renderHook(() => useDeleteRole(), { wrapper: wrap() });
    act(() => {
      result.current.mutate({ tenant: TENANT, id: 'role-1' });
    });
    await waitFor(() => { expect(recorded.length).toBe(1); });
    expect(recorded[0]?.method).toBe('DELETE');
  });

  it('users: useCreateUser POSTs /api/v1/t/:tenant/users with email body', async () => {
    const recorded = captureRequest('POST', `*/api/v1/t/${TENANT}/users`, 201);
    const { result } = renderHook(() => useCreateUser(), { wrapper: wrap() });
    act(() => {
      result.current.mutate({ tenant: TENANT, data: { email: 'new@acme.test' } });
    });
    await waitFor(() => { expect(recorded.length).toBe(1); });
    expect(recorded[0]?.body).toMatchObject({ email: 'new@acme.test' });
  });

  it('users: useSuspendUser POSTs /api/v1/t/:tenant/users/:id/suspend', async () => {
    const recorded = captureRequest('POST', `*/api/v1/t/${TENANT}/users/u1/suspend`, 204);
    const { result } = renderHook(() => useSuspendUser(), { wrapper: wrap() });
    act(() => {
      result.current.mutate({ tenant: TENANT, id: 'u1' });
    });
    await waitFor(() => { expect(recorded.length).toBe(1); });
    expect(recorded[0]?.url).toContain('/suspend');
  });

  it('sessions: useRevokeSession DELETEs the session resource', async () => {
    const recorded = captureRequest('DELETE', `*/api/v1/t/${TENANT}/sessions/sess-1`, 204);
    const { result } = renderHook(() => useRevokeSession(), { wrapper: wrap() });
    act(() => {
      result.current.mutate({ tenant: TENANT, id: 'sess-1' });
    });
    await waitFor(() => { expect(recorded.length).toBe(1); });
    expect(recorded[0]?.method).toBe('DELETE');
  });

  it('api-keys: useCreateAPIKey + useRevokeAPIKey hit the right paths', async () => {
    const created = captureRequest('POST', `*/api/v1/t/${TENANT}/api-keys`, 201);
    const { result: createH } = renderHook(() => useCreateAPIKey(), { wrapper: wrap() });
    act(() => {
      createH.current.mutate({ tenant: TENANT, data: { name: 'ci-key' } });
    });
    await waitFor(() => { expect(created.length).toBe(1); });
    expect(created[0]?.body).toMatchObject({ name: 'ci-key' });

    const revoked = captureRequest('POST', `*/api/v1/t/${TENANT}/api-keys/k1/revoke`, 204);
    const { result: revokeH } = renderHook(() => useRevokeAPIKey(), { wrapper: wrap() });
    act(() => {
      revokeH.current.mutate({ tenant: TENANT, id: 'k1' });
    });
    await waitFor(() => { expect(revoked.length).toBe(1); });
  });

  it('access-policies: useCreateAccessPolicy POSTs the right path', async () => {
    const recorded = captureRequest(
      'POST',
      `*/api/v1/t/${TENANT}/access-policies`,
      201,
    );
    const { result } = renderHook(() => useCreateAccessPolicy(), { wrapper: wrap() });
    act(() => {
      result.current.mutate({
        tenant: TENANT,
        data: { name: 'biz-hours', expression: 'now() < 18:00' },
      });
    });
    await waitFor(() => { expect(recorded.length).toBe(1); });
    expect(recorded[0]?.body).toMatchObject({ name: 'biz-hours' });
  });

  it('rbac-policies: useCreateRbacPolicy POSTs subject-binding body', async () => {
    const recorded = captureRequest(
      'POST',
      `*/api/v1/t/${TENANT}/rbac-policies`,
      201,
    );
    const { result } = renderHook(() => useCreateRbacPolicy(), { wrapper: wrap() });
    act(() => {
      result.current.mutate({
        tenant: TENANT,
        data: {
          name: 'devs-bind',
          subjectType: 'user',
          subjectId: 'u-1',
          roleId: 'r-1',
        },
      });
    });
    await waitFor(() => { expect(recorded.length).toBe(1); });
    expect(recorded[0]?.body).toMatchObject({
      subjectType: 'user',
      subjectId: 'u-1',
      roleId: 'r-1',
    });
  });

  it('impersonation: start + end mutations call the daemon paths', async () => {
    const startRecorded = captureRequest('POST', '*/api/v1/admin/impersonation', 201);
    const { result: startH } = renderHook(() => useStartImpersonation(), {
      wrapper: wrap(),
    });
    act(() => {
      startH.current.mutate({
        data: {
          tenantId: TENANT,
          targetUserId: 'u-target',
          reason: 'support-ticket-12345',
        },
      });
    });
    await waitFor(() => { expect(startRecorded.length).toBe(1); });
    expect(startRecorded[0]?.body).toMatchObject({ tenantId: TENANT });

    const endRecorded = captureRequest(
      'DELETE',
      '*/api/v1/admin/impersonation/imp-9',
      204,
    );
    const { result: endH } = renderHook(() => useEndImpersonation(), { wrapper: wrap() });
    act(() => {
      endH.current.mutate({ id: 'imp-9' });
    });
    await waitFor(() => { expect(endRecorded.length).toBe(1); });
  });
});
