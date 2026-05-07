/**
 * Tests for <AuditList> + the selector layer (`useAuditList` /
 * `useAuditListInfinite`) plus the per-entity deep-link route alias and
 * RBAC-gated reveal control.
 *
 * Stage-2 selector migration: the network leg is exercised through MSW
 * (default `setupServer` in `src/test/msw-server.ts`); per-test handler
 * overrides via `server.use(http.get(...))` give deterministic data.
 *
 * Covers (per Plan 05 / T1):
 *   - row rendering smoke
 *   - filter by actor narrows the result set
 *   - infinite-scroll fetchNextPage triggers a second fetch
 *   - viewer (no audit:read-sensitive) does NOT see Reveal
 *   - per-entity deep-link `?resource_type=service&resource_id=svc-1`
 *     pre-fills the filter via the route's `validateSearch`
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { useMockStore } from '@/api/mock-store';
import { AuditList } from '../components/list';
import { useAuditList, useAuditListInfinite, encodeActorHandle } from '../api';
import type { AuditEntry, AuditFilter, ID } from '../types';

// TanStack Router URL-sync — minimal shim used across list tests.
// `createFileRoute(...)` returns a factory that captures the route
// options so we can inspect `validateSearch` from the test.
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => () => undefined,
  useRouter: () => ({ navigate: () => undefined }),
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

// Default permission grant — individual tests flip the viewer scenarios.
let grantSensitive = true;
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) => (key === 'audit:read-sensitive' ? grantSensitive : true),
}));

function MakeWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    return (
      <MantineProvider>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MantineProvider>
    );
  };
}

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'audit-1' as ID,
    tenant_id: 't1' as ID,
    actor_id: 'u1' as ID,
    action: 'service.create',
    resource_type: 'service',
    resource_id: 'srv-001' as ID,
    outcome: 'success',
    at: '2026-04-10T12:34:00.000Z',
    tier: 'write',
    ...overrides,
  };
}

function emptyFilter(): AuditFilter {
  return {
    actions: [],
    outcomes: [],
    resource_types: [],
    tiers: [],
    date_from: null,
    date_to: null,
    actor_handles: [],
    resource_id_handles: [],
    search: '',
  };
}

beforeEach(() => {
  grantSensitive = true;
  useMockStore.getState().reset();
  useMockStore.setState({
    users: {
      u1: {
        id: 'u1' as ID,
        email: 'alice@example.com',
        name: 'Alice',
        disabled: false,
        totp_enabled: false,
        totp_enrolled: false,
        timezone: 'America/Los_Angeles',
        locale: 'en',
        reduced_motion: false,
        notification_preferences: { email: true, in_app: true, categories_muted: [] },
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    },
  });
});

afterEach(() => {
  server.resetHandlers();
});

// ─── Presentation: <AuditList> rows ──────────────────────────────────────────

describe('<AuditList> presentation', () => {
  const Wrapper = MakeWrapper();

  it('renders rows with actor name, action, resource chip, outcome and tier', () => {
    render(<AuditList rows={[makeEntry()]} onSelect={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('service.create')).toBeInTheDocument();
    expect(screen.getByText('service')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('write')).toBeInTheDocument();
  });

  it('renders TOTP shield icon when totp_verified is true', () => {
    render(<AuditList rows={[makeEntry({ totp_verified: true })]} onSelect={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByLabelText('TOTP verified')).toBeInTheDocument();
  });

  it('does not render TOTP icon when totp_verified is falsy', () => {
    render(<AuditList rows={[makeEntry()]} onSelect={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.queryByLabelText('TOTP verified')).not.toBeInTheDocument();
  });

  it('calls onSelect when the view-detail action is clicked', () => {
    const onSelect = vi.fn();
    render(<AuditList rows={[makeEntry()]} onSelect={onSelect} />, {
      wrapper: Wrapper,
    });
    fireEvent.click(screen.getByTestId('audit-row-view-audit-1'));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'audit-1' }));
  });

  it('renders "admin" badge when acted_as_admin is true', () => {
    render(<AuditList rows={[makeEntry({ acted_as_admin: true })]} onSelect={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('empty-state renders when rows is empty', () => {
    render(<AuditList rows={[]} onSelect={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText('No audit entries')).toBeInTheDocument();
  });
});

// ─── Selector layer: useAuditList against MSW-served daemon endpoint ─────────

describe('useAuditList — daemon-backed selector', () => {
  const Wrapper = MakeWrapper();

  it('fetches entries from the daemon list endpoint and renders them', async () => {
    server.use(
      http.get('*/api/v1/t/:tenant/audit', () =>
        HttpResponse.json([
          {
            id: 'a1',
            actor: 'u1',
            entityType: 'service',
            entityId: 'svc-1',
            operation: 'service.create',
            occurredAt: '2026-04-10T12:34:00Z',
          },
          {
            id: 'a2',
            actor: 'u1',
            entityType: 'route',
            entityId: 'r-1',
            operation: 'route.update',
            occurredAt: '2026-04-09T12:00:00Z',
          },
        ]),
      ),
    );
    const { result } = renderHook(() => useAuditList('t1', emptyFilter()), {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(result.current.length).toBe(2);
    });
    // Sorted desc by `at` — service.create (later) is first.
    expect(result.current[0]!.id).toBe('a1');
    expect(result.current[1]!.id).toBe('a2');
  });

  it('filters by actor handle — narrowing to a single user', async () => {
    let observedActor: string | null = null;
    server.use(
      http.get('*/api/v1/t/:tenant/audit', ({ request }) => {
        const url = new URL(request.url);
        observedActor = url.searchParams.get('actor');
        const all = [
          {
            id: 'a-alice',
            actor: 'u1',
            entityType: 'service',
            entityId: 'svc-1',
            operation: 'x',
            occurredAt: '2026-04-10T12:00:00Z',
          },
          {
            id: 'a-bob',
            actor: 'u2',
            entityType: 'service',
            entityId: 'svc-2',
            operation: 'x',
            occurredAt: '2026-04-09T12:00:00Z',
          },
        ].filter((e) => observedActor === null || e.actor === observedActor);
        return HttpResponse.json(all);
      }),
    );
    const filter: AuditFilter = {
      ...emptyFilter(),
      actor_handles: [encodeActorHandle('u1' as ID)],
    };
    const { result } = renderHook(() => useAuditList('t1', filter), {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(result.current.length).toBe(1);
    });
    expect(result.current[0]!.actor_id).toBe('u1');
    // The selector forwards the `actor` param to the daemon — proves the
    // server-side narrowing is wired, not just a client post-filter.
    expect(observedActor).toBe('u1');
  });
});

// ─── Selector layer: infinite scroll triggers a second fetch ────────────────

describe('useAuditListInfinite — pagination', () => {
  const Wrapper = MakeWrapper();

  it('fetchNextPage issues a second request with offset advanced', async () => {
    const offsets: string[] = [];
    server.use(
      http.get('*/api/v1/t/:tenant/audit', ({ request }) => {
        const url = new URL(request.url);
        const offset = url.searchParams.get('offset') ?? '0';
        offsets.push(offset);
        // Return a full page of `limit` entries on offset=0 so
        // hasNextPage becomes true; return zero on offset>=10 so
        // pagination terminates.
        if (offset === '0') {
          return HttpResponse.json(
            Array.from({ length: 10 }, (_, i) => ({
              id: `p1-${String(i)}`,
              actor: 'u1',
              entityType: 'service',
              entityId: `svc-${String(i)}`,
              operation: 'op',
              occurredAt: `2026-04-${String(20 - i).padStart(2, '0')}T12:00:00Z`,
            })),
          );
        }
        return HttpResponse.json(
          Array.from({ length: 3 }, (_, i) => ({
            id: `p2-${String(i)}`,
            actor: 'u1',
            entityType: 'service',
            entityId: `svc-${String(10 + i)}`,
            operation: 'op',
            occurredAt: `2026-04-${String(10 - i).padStart(2, '0')}T12:00:00Z`,
          })),
        );
      }),
    );
    const { result } = renderHook(() => useAuditListInfinite('t1', emptyFilter(), 10), {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(result.current.data.length).toBe(10);
    });
    expect(result.current.hasNextPage).toBe(true);
    act(() => {
      result.current.fetchNextPage();
    });
    await waitFor(() => {
      expect(offsets.length).toBeGreaterThanOrEqual(2);
    });
    expect(offsets[0]).toBe('0');
    expect(offsets[1]).toBe('10');
    await waitFor(() => {
      expect(result.current.data.length).toBe(13);
    });
  });
});

// ─── RBAC negative: viewer does NOT see the Reveal button ───────────────────

describe('RBAC — Reveal control', () => {
  const Wrapper = MakeWrapper();

  it('viewer without audit:read-sensitive does not see Reveal', async () => {
    grantSensitive = false;
    const { AuditDetail } = await import('../components/detail');
    render(
      <AuditDetail
        entry={makeEntry({ ip: '10.0.0.1', payload: { x: 1 } })}
        onClose={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.queryByTestId('audit-reveal-sensitive')).not.toBeInTheDocument();
  });

  it('admin with audit:read-sensitive sees Reveal', async () => {
    grantSensitive = true;
    const { AuditDetail } = await import('../components/detail');
    render(
      <AuditDetail
        entry={makeEntry({ ip: '10.0.0.1', payload: { x: 1 } })}
        onClose={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('audit-reveal-sensitive')).toBeInTheDocument();
  });
});

// ─── Per-entity deep-link: `?resource_type=service&resource_id=svc-1` ───────

describe('Per-entity deep-link — validateSearch alias', () => {
  it('expands resource_type/_id into canonical multi-handle filter', async () => {
    // Pull the validateSearch closure off the route definition. The
    // route module imports a lot — the import is async to keep the
    // top-of-file vi.mock hoisting clean.
    const mod = await import('@/routes/t.$tenant/security/audit');
    const validate = mod.Route.options.validateSearch as (
      s: Record<string, unknown>,
    ) => Record<string, unknown>;
    const out = validate({ resource_type: 'service', resource_id: 'svc-1' });
    expect(out.resource_types).toEqual(['service']);
    expect(out.resource_id_handles).toEqual(['res_service_svc-1']);
  });

  it('also accepts the `entity_type` / `entity_id` aliases', async () => {
    const mod = await import('@/routes/t.$tenant/security/audit');
    const validate = mod.Route.options.validateSearch as (
      s: Record<string, unknown>,
    ) => Record<string, unknown>;
    const out = validate({ entity_type: 'route', entity_id: 'r-42' });
    expect(out.resource_types).toEqual(['route']);
    expect(out.resource_id_handles).toEqual(['res_route_r-42']);
  });
});
