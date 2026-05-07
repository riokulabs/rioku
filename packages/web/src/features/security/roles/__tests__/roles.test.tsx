/**
 * Roles slice — real-API contract tests.
 *
 * Drives the rewritten `api.ts` (Orval-backed) through MSW to verify:
 *
 *   1. List loads + adapts daemon payloads to the legacy `Role` shape.
 *   2. Grant flow — `assignUserRole` POSTs the right path/body; revoke
 *      DELETEs the right path.
 *   3. Viewer (canWrite=false) does NOT see the Edit/Delete/Save UI.
 *   4. Source badge renders for permissions with a known source.
 *   5. Orphaned-permission alert appears when a grant references a
 *      permission absent from the live catalog.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';

import { server } from '@/test/msw-server';
import { useRoleList } from '../api';
import { useAssignUserRole, useRevokeUserRole } from '../realApi';
import { RoleDetail } from '../components/detail';
import type { Role } from '@/api/resources';

const TENANT = 'acme';

function makeWrapper(): (props: { children: ReactNode }) => ReactNode {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MantineProvider defaultColorScheme="dark">
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MantineProvider>
    );
  }
  return Wrapper;
}

describe('roles slice — real-API selectors', () => {
  it('useRoleList: fetches and adapts the daemon role list', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/roles`, () =>
        HttpResponse.json({
          roles: [
            {
              id: 'role-admins',
              tenantId: TENANT,
              name: 'admins',
              permissions: ['user:read', 'user:write'],
              source: 'custom',
            },
            {
              id: 'role-builtin',
              tenantId: TENANT,
              name: 'system-admin',
              permissions: ['*'],
              source: 'builtin',
            },
          ],
        }),
      ),
    );

    const { result } = renderHook(() => useRoleList(TENANT), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(result.current.length).toBe(2);
    });

    const admins = result.current.find((r) => r.id === 'role-admins');
    expect(admins).toBeDefined();
    expect(admins?.name).toBe('admins');
    expect(admins?.grants.map((g) => g.permission)).toEqual(['user:read', 'user:write']);
    expect(admins?.system).toBe(false);

    const sys = result.current.find((r) => r.id === 'role-builtin');
    expect(sys?.system).toBe(true);
  });
});

describe('roles slice — grant / revoke real-API mutations', () => {
  it('useAssignUserRole POSTs the right path with the role id body', async () => {
    const recorded: { method: string; url: string; body: unknown }[] = [];
    server.use(
      http.post(`*/api/v1/t/${TENANT}/users/u-7/roles`, async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          body = undefined;
        }
        recorded.push({ method: request.method, url: request.url, body });
        return new HttpResponse(null, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useAssignUserRole(), { wrapper: makeWrapper() });
    act(() => {
      result.current.mutate({ tenant: TENANT, id: 'u-7', data: { roleId: 'role-admins' } });
    });

    await waitFor(() => {
      expect(recorded.length).toBe(1);
    });
    expect(recorded[0]?.method).toBe('POST');
    expect(recorded[0]?.url).toContain(`/api/v1/t/${TENANT}/users/u-7/roles`);
    expect(recorded[0]?.body).toMatchObject({ roleId: 'role-admins' });
  });

  it('useRevokeUserRole DELETEs the per-role path', async () => {
    const recorded: { method: string; url: string }[] = [];
    server.use(
      http.delete(`*/api/v1/t/${TENANT}/users/u-7/roles/role-admins`, ({ request }) => {
        recorded.push({ method: request.method, url: request.url });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result } = renderHook(() => useRevokeUserRole(), { wrapper: makeWrapper() });
    act(() => {
      result.current.mutate({ tenant: TENANT, id: 'u-7', roleId: 'role-admins' });
    });

    await waitFor(() => {
      expect(recorded.length).toBe(1);
    });
    expect(recorded[0]?.method).toBe('DELETE');
    expect(recorded[0]?.url).toContain('/users/u-7/roles/role-admins');
  });
});

describe('RoleDetail — RBAC + RD6 surface', () => {
  // Common MSW stubs: the detail page hits the catalog and the
  // user-list under the hood (via useRoleUserCounts).
  function stubAuxiliaryEndpoints(opts: { catalog: { id: string; source: string }[] }) {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/permissions`, () =>
        HttpResponse.json({ permissions: opts.catalog }),
      ),
      http.get(`*/api/v1/t/${TENANT}/users`, () => HttpResponse.json({ users: [] })),
      http.get(`*/api/v1/t/${TENANT}/roles`, () => HttpResponse.json({ roles: [] })),
    );
  }

  function makeRole(overrides: Partial<Role> = {}): Role {
    return {
      id: 'role-x',
      tenant_id: TENANT,
      name: 'role-x',
      parent_ids: [],
      grants: [],
      denies: [],
      system: false,
      ...overrides,
    };
  }

  it('viewer (canWrite=false) cannot see Delete or Save controls', async () => {
    stubAuxiliaryEndpoints({ catalog: [{ id: 'user:read', source: 'built-in' }] });

    const role = makeRole({
      grants: [{ permission: 'user:read' }],
    });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoleDetail
          tenant={TENANT}
          role={role}
          canWrite={false}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </Wrapper>,
    );

    // Wait for the detail to render
    await screen.findByText('role-x');

    expect(screen.queryByTestId('role-delete-button')).toBeNull();
    expect(screen.queryByTestId('role-save-button')).toBeNull();
  });

  it('admin (canWrite=true) sees Delete + Save controls', async () => {
    stubAuxiliaryEndpoints({ catalog: [{ id: 'user:read', source: 'built-in' }] });

    const role = makeRole({ grants: [{ permission: 'user:read' }] });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoleDetail
          tenant={TENANT}
          role={role}
          canWrite
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </Wrapper>,
    );

    await screen.findByText('role-x');
    expect(screen.getByTestId('role-delete-button')).toBeInTheDocument();
    expect(screen.getByTestId('role-save-button')).toBeInTheDocument();
  });

  it('renders source badge with the catalog-reported source', async () => {
    stubAuxiliaryEndpoints({
      catalog: [
        { id: 'user:read', source: 'built-in' },
        { id: 'billing:invoice', source: 'plugin-manifest' },
      ],
    });

    const role = makeRole({
      grants: [{ permission: 'user:read' }, { permission: 'billing:invoice' }],
    });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoleDetail
          tenant={TENANT}
          role={role}
          canWrite
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </Wrapper>,
    );

    // The grants tab is not the default — switch to it.
    const grantsTab = await screen.findByRole('tab', { name: 'Grants' });
    act(() => {
      grantsTab.click();
    });

    const badges = await screen.findAllByTestId('grant-source-badge');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    const labels = badges.map((b) => b.textContent);
    expect(labels.some((l) => typeof l === 'string' && l.includes('built-in'))).toBe(true);
  });

  it('orphan alert appears when a grant references a permission missing from the catalog', async () => {
    // The catalog returns ONLY user:read. The role grants
    // `billing:legacy` — that one should be flagged ORPHANED.
    stubAuxiliaryEndpoints({
      catalog: [{ id: 'user:read', source: 'built-in' }],
    });

    const role = makeRole({
      grants: [{ permission: 'user:read' }, { permission: 'billing:legacy' }],
    });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoleDetail
          tenant={TENANT}
          role={role}
          canWrite
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </Wrapper>,
    );

    const grantsTab = await screen.findByRole('tab', { name: 'Grants' });
    act(() => {
      grantsTab.click();
    });

    // Wait for the catalog query to settle so the in-catalog grant
    // (user:read) renders its source badge — at that point the
    // remaining orphan alert is the truly-missing permission.
    await screen.findByTestId('grant-source-badge');

    await waitFor(() => {
      const orphanAlerts = screen.queryAllByTestId('grant-orphan-alert');
      expect(orphanAlerts.length).toBe(1);
      expect(orphanAlerts[0]?.textContent ?? '').toContain('billing:legacy');
    });
  });
});
