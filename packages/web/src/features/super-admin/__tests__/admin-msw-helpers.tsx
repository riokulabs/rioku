/**
 * MSW + TanStack Query helpers shared across the super-admin component tests.
 *
 * The orval-generated admin MSW handlers wrap responses in `delay(1000)` which
 * blows past Vitest's default 5s timeout under suite pressure. We register
 * zero-delay handlers via `server.use(...)` so tests resolve immediately.
 */
import { http, HttpResponse } from 'msw';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AdminTenant, ListAdminUsers200ItemsItem } from '@/api/generated/schemas';
import { server } from '@/test/msw-server';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function AdminTestWrapper({
  children,
  client,
}: {
  children: React.ReactNode;
  client: QueryClient;
}): React.ReactElement {
  return (
    <QueryClientProvider client={client}>
      <MantineProvider>
        <ModalsProvider>{children}</ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
}

// ─── Per-resource handler factories (no delay, configurable response) ─────────

export function mockListTenants(items: AdminTenant[]): void {
  server.use(
    http.get('*/api/v1/admin/tenants', () =>
      HttpResponse.json({ items, total: items.length }, { status: 200 }),
    ),
  );
}

export function mockListTenantsError(status = 500): void {
  server.use(
    http.get('*/api/v1/admin/tenants', () => HttpResponse.json({ title: 'failed' }, { status })),
  );
}

export function mockCreateTenant(onCreate?: (body: Record<string, unknown>) => void): void {
  server.use(
    http.post('*/api/v1/admin/tenants', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      onCreate?.(body);
      return HttpResponse.json(
        {
          id: 'created-id',
          slug: body.slug ?? 'new',
          name: body.name ?? 'new',
          plan: body.plan ?? 'community',
          urlMode: body.urlMode ?? 'path',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { status: 201 },
      );
    }),
  );
}

export function mockDeleteTenant(onDelete?: (id: string) => void): void {
  server.use(
    http.delete('*/api/v1/admin/tenants/:id', ({ params }) => {
      onDelete?.(params.id as string);
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

export function mockListUsers(items: ListAdminUsers200ItemsItem[]): void {
  server.use(
    http.get('*/api/v1/admin/users', () =>
      HttpResponse.json({ items, total: items.length }, { status: 200 }),
    ),
  );
}

export function mockListAudit(items: unknown[], note?: string): void {
  server.use(
    http.get('*/api/v1/admin/audit', () =>
      HttpResponse.json(
        {
          items,
          total: items.length,
          ...(note !== undefined ? { note } : {}),
        },
        { status: 200 },
      ),
    ),
  );
}

// ─── Canonical fixtures ───────────────────────────────────────────────────────

export const SAMPLE_TENANTS: AdminTenant[] = [
  {
    id: 'tenant-acme',
    slug: 'acme',
    name: 'Acme Corp',
    plan: 'enterprise',
    urlMode: 'subdomain',
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-02T12:00:00.000Z',
  },
  {
    id: 'tenant-beta',
    slug: 'beta',
    name: 'Beta Industries',
    plan: 'pro',
    urlMode: 'path',
    createdAt: '2026-02-01T12:00:00.000Z',
    updatedAt: '2026-02-02T12:00:00.000Z',
  },
  {
    id: 'tenant-gamma',
    slug: 'gamma',
    name: 'Gamma Co',
    plan: 'community',
    urlMode: 'path',
    createdAt: '2026-03-01T12:00:00.000Z',
    updatedAt: '2026-03-02T12:00:00.000Z',
  },
];

export const SAMPLE_USERS: ListAdminUsers200ItemsItem[] = [
  { id: 'user-1', username: 'alice', status: 'active' },
  { id: 'user-2', username: 'bob', status: 'active' },
  { id: 'user-3', username: 'charlie', status: 'disabled' },
  { id: 'user-4', username: 'dora', status: 'pending' },
];

/**
 * Hash-chained admin audit entries with valid linkage. Useful for verify-chain
 * happy path. Hashes here are placeholders — verifyAdminAuditChain recomputes
 * them, so chain integrity is validated against fresh fixture data per test.
 */
