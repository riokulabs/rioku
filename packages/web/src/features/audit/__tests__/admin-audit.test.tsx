// @vitest-environment jsdom
/**
 * Tests for the tenant-scoped admin audit hash-chain page.
 *
 * Covers:
 *   - Renders empty state when no adminAudit entries for tenant
 *   - Renders entries from mock store filtered by tenant_id
 *   - Verify chain button: passes for valid chain
 *   - Verify chain button: reports broken link for corrupted chain
 *   - "Back to audit log" link is rendered
 *
 * Tests import the page component directly (not via router) to avoid
 * routeTree complexity. We stub `createFileRoute` so the component can
 * be rendered in isolation.
 *
 * Plan 5 Task 6
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub TanStack Router before any component imports
vi.mock('@tanstack/react-router', () => ({
  // createFileRoute(path)(opts) — two-call pattern.
  // Returns opts merged with route hooks so Route.useParams() works in the component.
  createFileRoute: () => (opts: { component: unknown; beforeLoad?: unknown }) => ({
    ...opts,
    useParams: () => ({ tenant: 'acme' }),
    useSearch: () => ({}),
    useLoaderData: () => ({}),
  }),
  Link: ({ children, ...rest }: { children: React.ReactNode } & Record<string, unknown>) => (
    <a {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  useParams: () => ({ tenant: 'acme' }),
}));

vi.mock('@/hooks/use-permission', () => ({
  usePermission: () => true,
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { logAdminAuditEntry } from '@/api/resources/audit';
import type { AdminAuditEntry } from '@/api/resources';

// ─── Component under test ────────────────────────────────────────────────────

// Import the component factory. The route file exports `Route.component`
// via `createFileRoute(...)({ ..., component: TenantAdminAuditPage })`.
// We import the module and use the component directly.
// Since we mock createFileRoute to return `{ component: c => c }`,
// we get back the component directly from the default binding.

// We need to access TenantAdminAuditPage. Since it's not a named export,
// we render by importing the Route export and calling its component.
// Instead, let's render the component indirectly through the Route object.

// Actually, the route file does: export const Route = createFileRoute(...)({ ..., component: TenantAdminAuditPage })
// With our mock, createFileRoute returns (opts) => opts, so Route === opts.
// Route.component === TenantAdminAuditPage.

import { Route } from '@/routes/t.$tenant/security/audit_.admin';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <ModalsProvider>{ui}</ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

function acmeTenantId(): string {
  // The page filters audit entries by `useParams().tenant` which the route
  // mock injects as the slug 'acme'. Store entries with the slug so the
  // hash chain stays valid and the filter matches.
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  return 'acme';
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  // Clear adminAudit so tests start clean
  useMockStore.setState({ adminAudit: [] });
  // Bridge: page reads admin audit via Orval; bridge to mock-store entries.
  server.use(
    http.get('*/api/v1/admin/audit', () => {
      const items = useMockStore.getState().adminAudit;
      return HttpResponse.json({ items, total: items.length });
    }),
    http.get('*/api/v1/t/:tenant/users', () => {
      return HttpResponse.json({ items: [], total: 0 });
    }),
  );
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TenantAdminAuditPage', () => {
  it('renders the empty state when no adminAudit entries for tenant', () => {
    const Component = (Route as unknown as { component: React.ComponentType }).component;
    wrap(<Component />);
    expect(screen.getByTestId('tenant-admin-audit-page')).toBeInTheDocument();
    expect(screen.getByText('No admin audit entries')).toBeInTheDocument();
  });

  it('renders entries filtered by tenant_id', async () => {
    const tenantId = acmeTenantId();
    await logAdminAuditEntry({
      tenant_id: tenantId,
      actor_id: 'u-admin',
      action: 'impersonation.start',
      resource_type: 'user',
      outcome: 'success',
      tier: 'destructive',
    });

    // Also add an entry for a different tenant — should NOT appear
    await logAdminAuditEntry({
      tenant_id: 'other-tenant-id',
      actor_id: 'u-admin',
      action: 'impersonation.start',
      resource_type: 'user',
      outcome: 'success',
      tier: 'destructive',
    });

    const Component = (Route as unknown as { component: React.ComponentType }).component;
    wrap(<Component />);

    // The page renders each action twice: once in the DataTable row, once in the
    // accordion control. With 1 acme entry the count is 2; if the other-tenant entry
    // leaked it would be 4.
    await waitFor(() => {
      const badges = screen.getAllByText('impersonation.start');
      expect(badges).toHaveLength(2); // 1 entry × 2 occurrences (table + accordion)
    });
  });

  it('verify chain button shows "Chain verified" badge for a valid chain', async () => {
    const tenantId = acmeTenantId();
    await logAdminAuditEntry({
      tenant_id: tenantId,
      actor_id: 'u-admin',
      action: 'impersonation.start',
      resource_type: 'user',
      outcome: 'success',
      tier: 'destructive',
    });
    await logAdminAuditEntry({
      tenant_id: tenantId,
      actor_id: 'u-admin',
      action: 'impersonation.end',
      resource_type: 'user',
      outcome: 'success',
      tier: 'read',
    });

    const Component = (Route as unknown as { component: React.ComponentType }).component;
    wrap(<Component />);

    // Wait for entries to land via useListAdminAudit before verifying.
    await waitFor(() => {
      expect(screen.getAllByText('impersonation.start').length).toBeGreaterThan(0);
    });

    const verifyBtn = screen.getByTestId('verify-chain-button');
    fireEvent.click(verifyBtn);

    // SHA-256 hash-chain verification dispatches into the WebCrypto async
    // queue; the default 1s waitFor timeout flakes on slower CI runners.
    await waitFor(
      () => {
        expect(screen.getByTestId('chain-verified-badge')).toBeInTheDocument();
      },
      { timeout: 15000 },
    );
  }, 20000);

  it('verify chain button shows "Broken at entry" badge for a corrupted chain', async () => {
    const tenantId = acmeTenantId();

    // Manually push a corrupted entry (wrong prev_hash)
    const corruptEntry: AdminAuditEntry = {
      id: 'corrupt-1',
      kind: 'admin',
      tenant_id: tenantId,
      actor_id: 'u-admin',
      action: 'impersonation.start',
      resource_type: 'user',
      outcome: 'success',
      at: new Date().toISOString(),
      tier: 'destructive',
      prev_hash: 'wrong-prev-hash',
      hash: 'some-hash',
    };
    useMockStore.getState().appendAdminAudit(corruptEntry);

    const Component = (Route as unknown as { component: React.ComponentType }).component;
    wrap(<Component />);

    // Wait for the entry to land via useListAdminAudit before triggering verify;
    // otherwise we verify over an empty array and the chain is reported valid.
    await waitFor(() => {
      expect(screen.getAllByText('impersonation.start').length).toBeGreaterThan(0);
    });

    const verifyBtn = screen.getByTestId('verify-chain-button');
    fireEvent.click(verifyBtn);

    await waitFor(
      () => {
        expect(screen.getByTestId('chain-broken-badge')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it('renders the "Back to audit log" link', () => {
    const Component = (Route as unknown as { component: React.ComponentType }).component;
    wrap(<Component />);
    expect(screen.getByTestId('admin-audit-back')).toBeInTheDocument();
  });

  it('shows hash and prev_hash in accordion for each entry', async () => {
    const tenantId = acmeTenantId();
    await logAdminAuditEntry({
      tenant_id: tenantId,
      actor_id: 'u-admin',
      action: 'role.update',
      resource_type: 'role',
      outcome: 'success',
      tier: 'write',
    });

    const Component = (Route as unknown as { component: React.ComponentType }).component;
    wrap(<Component />);

    // The accordion shows entries; check that hash/prev_hash elements exist
    const entries = useMockStore.getState().adminAudit.filter((e) => e.tenant_id === tenantId);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    await waitFor(() => {
      expect(screen.getByTestId(`hash-${entry.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`prev-hash-${entry.id}`)).toBeInTheDocument();
  });
});
