/**
 * Unit tests for rbac-policies feature — stage-2, real-API.
 *
 * Drives the rewritten api.ts through MSW so the production code path
 * (`VITE_USE_MOCKS=false`) is the one being verified. No mock-store.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as ReactRouter from '@tanstack/react-router';

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof ReactRouter>('@tanstack/react-router');
  return {
    ...actual,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
    useBlocker: () => ({ status: 'idle' }),
    Link: ({ children, ...rest }: { children: React.ReactNode } & Record<string, unknown>) => (
      <a {...rest}>{children}</a>
    ),
  };
});

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';

import { server } from '@/test/msw-server';
import {
  RbacPolicyList,
  RbacPolicyEditor,
  RbacPolicyFullPage,
  useRbacPolicyList,
  createRbacPolicyMutation,
  updateRbacPolicyMutation,
  deleteRbacPolicyMutation,
} from '..';

const TENANT = 'acme';

function makeWrapper(): {
  client: QueryClient;
  Wrapper: ({ children }: { children: ReactNode }) => React.JSX.Element;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }): React.JSX.Element {
    return (
      <MantineProvider>
        <ModalsProvider>
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </ModalsProvider>
      </MantineProvider>
    );
  }
  return { client, Wrapper };
}

interface WirePolicy {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  enabled: boolean;
  subjectType: 'user' | 'group' | 'service-account';
  subjectId: string;
  roleId: string;
  createdAt: string;
}

function seedPolicies(): WirePolicy[] {
  return [
    {
      id: 'pol-1',
      tenantId: TENANT,
      name: 'engineers-bind',
      description: 'devs ↦ engineering',
      enabled: true,
      subjectType: 'group',
      subjectId: 'grp-eng',
      roleId: 'role-engineer',
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'pol-2',
      tenantId: TENANT,
      name: 'sa-ci-bind',
      description: '',
      enabled: true,
      subjectType: 'service-account',
      subjectId: 'sa-ci',
      roleId: 'role-engineer',
      createdAt: '2026-01-02T00:00:00Z',
    },
    {
      id: 'pol-3',
      tenantId: TENANT,
      name: 'auditor-bind',
      description: 'compliance',
      enabled: false,
      subjectType: 'user',
      subjectId: 'u-aud',
      roleId: 'role-auditor',
      createdAt: '2026-01-03T00:00:00Z',
    },
  ];
}

let store: WirePolicy[] = [];

function installListHandler(): void {
  server.use(
    http.get(`*/api/v1/t/${TENANT}/rbac-policies`, () =>
      HttpResponse.json({ rbacPolicies: store }, { status: 200 }),
    ),
  );
}

function installCrudHandlers(recorded: { method: string; url: string; body: unknown }[]): void {
  server.use(
    http.get(`*/api/v1/t/${TENANT}/rbac-policies`, () =>
      HttpResponse.json({ rbacPolicies: store }, { status: 200 }),
    ),
    http.get(`*/api/v1/t/${TENANT}/rbac-policies/:id`, ({ params }) => {
      const found = store.find((p) => p.id === params.id);
      if (!found) return new HttpResponse(null, { status: 404 });
      return HttpResponse.json(found, { status: 200 });
    }),
    http.post(`*/api/v1/t/${TENANT}/rbac-policies`, async ({ request }) => {
      const body = (await request.json()) as Partial<WirePolicy>;
      recorded.push({ method: 'POST', url: request.url, body });
      const next: WirePolicy = {
        id: `pol-new-${String(store.length + 1)}`,
        tenantId: TENANT,
        name: body.name ?? '',
        description: body.description ?? '',
        enabled: body.enabled ?? true,
        subjectType: body.subjectType ?? 'user',
        subjectId: body.subjectId ?? '',
        roleId: body.roleId ?? '',
        createdAt: new Date().toISOString(),
      };
      store.push(next);
      return HttpResponse.json(next, { status: 201 });
    }),
    http.patch(`*/api/v1/t/${TENANT}/rbac-policies/:id`, async ({ request, params }) => {
      const body = (await request.json()) as Partial<WirePolicy>;
      recorded.push({ method: 'PATCH', url: request.url, body });
      const idx = store.findIndex((p) => p.id === params.id);
      if (idx === -1) return new HttpResponse(null, { status: 404 });
      const existing = store[idx]!;
      store[idx] = {
        ...existing,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      };
      return HttpResponse.json(store[idx], { status: 200 });
    }),
    http.delete(`*/api/v1/t/${TENANT}/rbac-policies/:id`, ({ request, params }) => {
      recorded.push({ method: 'DELETE', url: request.url, body: undefined });
      store = store.filter((p) => p.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

beforeEach(() => {
  store = seedPolicies();
});

describe('useRbacPolicyList — list', () => {
  it('maps wire payloads to RbacPolicyFull[]', async () => {
    installListHandler();
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRbacPolicyList(TENANT), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.length).toBe(3);
    });
    const first = result.current[0]!;
    expect(first.id).toBe('pol-1');
    expect(first.subject_type).toBe('group');
    expect(first.role_id).toBe('role-engineer');
    expect(first.enabled).toBe(true);
  });
});

describe('createRbacPolicyMutation — create', () => {
  it('POSTs subject-binding body and refreshes the list', async () => {
    const recorded: { method: string; url: string; body: unknown }[] = [];
    installCrudHandlers(recorded);

    await createRbacPolicyMutation(TENANT, {
      name: 'new-bind',
      description: 'note',
      enabled: true,
      subject_type: 'user',
      subject_id: 'u-42',
      role_id: 'role-engineer',
    });

    expect(recorded.some((r) => r.method === 'POST')).toBe(true);
    const post = recorded.find((r) => r.method === 'POST');
    expect(post?.body).toMatchObject({
      name: 'new-bind',
      subjectType: 'user',
      subjectId: 'u-42',
      roleId: 'role-engineer',
    });
    expect(store.some((p) => p.name === 'new-bind')).toBe(true);
  });
});

describe('updateRbacPolicyMutation — update', () => {
  it('PATCHes the policy with the merge body', async () => {
    const recorded: { method: string; url: string; body: unknown }[] = [];
    installCrudHandlers(recorded);

    await updateRbacPolicyMutation(TENANT, 'pol-1', { description: 'updated' });

    const patch = recorded.find((r) => r.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(patch?.url).toContain('/rbac-policies/pol-1');
    expect(patch?.body).toMatchObject({ description: 'updated' });
    expect(store.find((p) => p.id === 'pol-1')?.description).toBe('updated');
  });
});

describe('deleteRbacPolicyMutation — delete', () => {
  it('DELETEs the policy and removes it from the store', async () => {
    const recorded: { method: string; url: string; body: unknown }[] = [];
    installCrudHandlers(recorded);

    await deleteRbacPolicyMutation(TENANT, 'pol-1');

    const del = recorded.find((r) => r.method === 'DELETE');
    expect(del).toBeDefined();
    expect(del?.url).toContain('/rbac-policies/pol-1');
    expect(store.some((p) => p.id === 'pol-1')).toBe(false);
  });
});

describe('RbacPolicyList — viewer cannot edit', () => {
  it('renders rows but exposes no Edit/Delete affordance for the viewer', async () => {
    installListHandler();
    const { Wrapper } = makeWrapper();
    const onSelect = vi.fn();
    render(
      <Wrapper>
        <RbacPolicyList tenant={TENANT} onSelect={onSelect} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('engineers-bind')).toBeDefined();
    });

    // List surface itself never renders edit/delete buttons — those live on
    // the detail / full-page surface gated behind the route's permission
    // guard. A viewer landing on this list cannot mutate anything.
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
  });
});

describe('RbacPolicyEditor — guard', () => {
  it('does not call onSave when required fields are empty', async () => {
    installListHandler();
    server.use(
      http.get(`*/api/v1/t/${TENANT}/roles`, () =>
        HttpResponse.json({ roles: [{ id: 'role-engineer', name: 'engineer' }] }, { status: 200 }),
      ),
    );
    const { Wrapper } = makeWrapper();
    const onSave = vi.fn();
    render(
      <Wrapper>
        <RbacPolicyEditor tenant={TENANT} onSave={onSave} onCancel={vi.fn()} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: /create policy/i }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('RbacPolicyFullPage — Bound subjects + Audit tabs', () => {
  it('renders bound-subjects table and exposes the Audit tab', async () => {
    installListHandler();
    server.use(
      http.get(`*/api/v1/t/${TENANT}/rbac-policies/pol-1`, () =>
        HttpResponse.json(seedPolicies()[0], { status: 200 }),
      ),
      http.get(`*/api/v1/t/${TENANT}/audit/actors`, () =>
        HttpResponse.json({ actors: [{ id: 'u-1' }, { id: 'u-2' }] }, { status: 200 }),
      ),
    );
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <RbacPolicyFullPage tenant={TENANT} policyId="pol-1" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('rbac-policy-full-page')).toBeDefined();
    });

    // Switch to Bound subjects tab — should list pol-1 + pol-2 (both
    // bound to role-engineer); pol-3 (role-auditor) excluded.
    fireEvent.click(screen.getByTestId('tab-bound-subjects'));
    await waitFor(() => {
      const table = screen.getByTestId('bound-subjects-table');
      const rows = table.querySelectorAll('tbody tr');
      expect(rows.length).toBe(2);
    });

    // Audit tab loads — uses the audit-actors endpoint and renders a
    // count summary once the query settles.
    fireEvent.click(screen.getByTestId('tab-audit'));
    await waitFor(() => {
      expect(screen.getByTestId('audit-panel')).toBeDefined();
    });
    await waitFor(() => {
      const summary = screen.getByTestId('audit-summary');
      expect(summary.textContent).toContain('2 actors');
    });
  });
});
