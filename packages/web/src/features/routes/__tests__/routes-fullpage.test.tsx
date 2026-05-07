/**
 * Vitest coverage for the Stage-2 route full-page experience.
 *
 * Scope (per plan-03 T3):
 *   1. <RouteFullPage> renders all four tabs (Overview / Middlewares /
 *      Policies / Audit) and switches between them.
 *   2. The Middlewares tab renders the drag-drop stack populated from the
 *      real `useRouteDetail` data (MSW), and the reorder mutation PUTs to
 *      the dedicated `/middlewares/order` endpoint.
 *   3. The Policies tab shows the access policies attached to the route.
 *
 * Drag-drop reorder is verified at the data-flow boundary (the mutation
 * fires with the new order and persists) — JSDOM cannot dispatch real
 * pointer-move events for `@dnd-kit`, so we exercise `applyOrder` via the
 * "remove from stack" code path which calls the same mutation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import type { V1Route } from '@/api/generated/schemas';
import { V1PathMatcherType } from '@/api/generated/schemas';
import { LBL_MIDDLEWARE_IDS } from '../adapter';
import { RouteFullPage } from '../components/full-page';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children }: { children: ReactNode }) => createElement('a', null, children),
}));

const TENANT = 'acme';
const ROUTE_ID = 'rt-fullpage-1';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderFullPage(qc: QueryClient = makeQueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <Notifications />
        <RouteFullPage tenantId={TENANT} routeId={ROUTE_ID} />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

function makeRouteFixture(middlewareIds: string[] = []): V1Route {
  const base: V1Route = {
    id: ROUTE_ID,
    name: 'fullpage-route',
    serviceId: 'svc-fp',
    enabled: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    policyIds: [],
    matchers: [
      {
        methods: ['GET'],
        paths: [{ type: V1PathMatcherType.TYPE_PREFIX, value: '/api/full' }],
      },
    ],
  };
  if (middlewareIds.length > 0) {
    base.labels = { labels: { [LBL_MIDDLEWARE_IDS]: middlewareIds.join(',') } };
  }
  return base;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

// ─── 1. All four tabs render ──────────────────────────────────────────────────

describe('RouteFullPage — tabs', () => {
  it('renders Overview / Middlewares / Policies / Audit tab triggers', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes/${ROUTE_ID}`, () =>
        HttpResponse.json(makeRouteFixture()),
      ),
      http.get(`*/api/v1/t/${TENANT}/routes`, () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
      http.get(`*/api/v1/t/${TENANT}/routes/${ROUTE_ID}/policies`, () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
    );

    renderFullPage();

    await waitFor(() => {
      expect(screen.getAllByText('fullpage-route').length).toBeGreaterThan(0);
    });

    for (const label of ['Overview', 'Middlewares', 'Policies', 'Audit']) {
      const tab = screen.getByRole('tab', { name: new RegExp(label, 'i') });
      expect(tab).toBeInTheDocument();
    }
  });

  it('switches to the Middlewares tab and renders the stack editor', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes/${ROUTE_ID}`, () =>
        HttpResponse.json(makeRouteFixture()),
      ),
      http.get(`*/api/v1/t/${TENANT}/routes/${ROUTE_ID}/policies`, () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
    );

    renderFullPage();

    await waitFor(() => {
      expect(screen.getAllByText('fullpage-route').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('tab', { name: /middlewares/i }));

    await waitFor(() => {
      expect(screen.getByTestId('middleware-stack-editor')).toBeInTheDocument();
    });
  });
});

// ─── 2. Middlewares reorder calls the dedicated endpoint ──────────────────────

describe('RouteFullPage — middleware reorder PUTs to dedicated endpoint', () => {
  it('removing a middleware from the stack PUTs the new order to the daemon', async () => {
    // Seed two middlewares the route depends on (they live in the
    // mock-store-backed middleware feature for now; Plan 04 will flip them).
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acme) throw new Error('acme tenant missing from seed');
    const tenantMids = Object.values(state.middlewares).filter(
      (m) => m.tenant_id === acme.id,
    );
    const [a, b] = tenantMids;
    if (!a || !b) throw new Error('seed needs >= 2 middlewares');

    let putBody: { order: string[] } | null = null;
    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes/${ROUTE_ID}`, () =>
        HttpResponse.json(makeRouteFixture([a.id, b.id])),
      ),
      http.get(`*/api/v1/t/${TENANT}/routes/${ROUTE_ID}/policies`, () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
      http.put(
        `*/api/v1/t/${TENANT}/routes/${ROUTE_ID}/middlewares/order`,
        async ({ request }) => {
          putBody = (await request.json()) as { order: string[] };
          return HttpResponse.json({
            id: ROUTE_ID,
            order: putBody.order,
            middlewareIds: putBody.order,
          });
        },
      ),
    );

    // Override the mock-store tenant id so `useMiddlewareList(TENANT, …)`
    // resolves the seeded fixtures (the seed uses an internal id; tests
    // work in slug space — mirror the seed by aliasing).
    useMockStore.setState((s) => {
      const newMids: typeof s.middlewares = {};
      for (const m of Object.values(s.middlewares)) {
        newMids[m.id] = m.tenant_id === acme.id ? { ...m, tenant_id: TENANT } : m;
      }
      return { middlewares: newMids };
    });

    renderFullPage();

    await waitFor(() => {
      expect(screen.getAllByText('fullpage-route').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('tab', { name: /middlewares/i }));

    await waitFor(() => {
      expect(screen.getByTestId(`stack-row-${a.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`stack-row-${b.id}`)).toBeInTheDocument();
    });

    // Trigger a reorder via the "remove from stack" button (same code
    // path as drag-end → applyOrder → mutation). This validates the wire
    // contract end-to-end without needing pointer-event simulation.
    const rowA = screen.getByTestId(`stack-row-${a.id}`);
    const removeBtn = within(rowA).getByLabelText(`Remove ${a.name} from stack`);
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(putBody).not.toBeNull();
    });
    expect(putBody).toEqual({ order: [b.id] });
  });
});

// ─── 3. Policies tab shows attached access-policies ───────────────────────────

describe('RouteFullPage — policies tab', () => {
  it('renders attached access-policies from the mock-store policy list', async () => {
    // The AttachedPolicies component reads from the mock-store-backed
    // `usePoliciesAttachedToRoute` selector (policies feature is owned by
    // a separate plan). To assert the policies tab actually shows
    // policies, seed the route's `policies` array in the mock store.
    const state = useMockStore.getState();
    const policy = Object.values(state.accessPolicies)[0];
    if (!policy) throw new Error('seed needs >= 1 access-policy');

    useMockStore.setState((s) => ({
      routes: {
        ...s.routes,
        [ROUTE_ID]: {
          id: ROUTE_ID,
          service_id: 'svc-fp',
          name: 'fullpage-route',
          path: '/api/full',
          method: 'GET',
          match_kind: 'prefix',
          strip_prefix: false,
          headers_add: {},
          headers_remove: [],
          policies: [policy.id],
          middleware_ids: [],
          enabled: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
        },
      },
    }));

    server.use(
      http.get(`*/api/v1/t/${TENANT}/routes/${ROUTE_ID}`, () =>
        HttpResponse.json(makeRouteFixture()),
      ),
      http.get(`*/api/v1/t/${TENANT}/routes/${ROUTE_ID}/policies`, () =>
        HttpResponse.json({ items: [{ id: policy.id }], total: 1 }),
      ),
    );

    renderFullPage();

    await waitFor(() => {
      expect(screen.getAllByText('fullpage-route').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('tab', { name: /policies/i }));

    await waitFor(() => {
      expect(screen.getByText(policy.name)).toBeInTheDocument();
    });
  });
});
