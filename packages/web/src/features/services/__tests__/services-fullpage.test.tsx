/**
 * Tests for <ServiceFullPage> — Stage 2 full-page detail view.
 *
 * The Overview / Health / Routes tabs read service data via the real
 * Stage-2 hook (Orval + TanStack Query, intercepted by MSW). The Audit
 * tab reads through `useAuditList`, which is mock-store backed (Plan 5
 * owns the audit endpoint flip), so the audit fixtures live in the
 * Zustand store.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import type { V1Service, ListServices200 } from '@/api/generated/schemas';
import type { AuditEntry } from '@/api/resources';
import { ServiceFullPage } from '../components/full-page';
import { LBL_ENV, LBL_PROTOCOL, LBL_TAGS } from '../adapter';

const TENANT = 'tenant-fullpage';
const SERVICE_ID = 'svc-fullpage-1';

function makeProtoService(overrides: Partial<V1Service> = {}): V1Service {
  return {
    id: SERVICE_ID,
    name: 'fullpage-api',
    upstreams: [{ address: 'http://backend:8080', healthy: true }],
    labels: {
      labels: {
        [LBL_ENV]: 'production',
        [LBL_TAGS]: 'critical,public',
        [LBL_PROTOCOL]: 'http',
      },
    },
    healthCheck: { path: '/healthz', intervalSeconds: 30, timeoutSeconds: 5 },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-04-01T12:00:00Z',
    ...overrides,
  };
}

function seedMinimalRoutes() {
  // Seed routes attached to SERVICE_ID directly into the mock store so the
  // mock-backed `useServiceRoutes` selector returns them on the Routes tab.
  // Using a manual seed (not seedStore()) keeps audit clean.
  const existing = useMockStore.getState().routes;
  useMockStore.setState({
    routes: {
      ...existing,
      'route-fp-1': {
        id: 'route-fp-1',
        name: 'list-users',
        service_id: SERVICE_ID,
        method: 'GET',
        path: '/api/users',
        match_kind: 'prefix',
        strip_prefix: false,
        headers_add: {},
        headers_remove: [],
        enabled: true,
        middleware_ids: [],
        policies: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      'route-fp-2': {
        id: 'route-fp-2',
        name: 'create-user',
        service_id: SERVICE_ID,
        method: 'POST',
        path: '/api/users',
        match_kind: 'prefix',
        strip_prefix: false,
        headers_add: {},
        headers_remove: [],
        enabled: false,
        middleware_ids: [],
        policies: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    },
  });
}

function seedAuditForService() {
  const entries: AuditEntry[] = [
    {
      id: 'aud-fp-1',
      tenant_id: TENANT,
      actor_id: 'user-1',
      action: 'service.create',
      resource_type: 'service',
      resource_id: SERVICE_ID,
      outcome: 'success',
      at: '2026-04-10T10:00:00Z',
      tier: 'write',
    },
    {
      id: 'aud-fp-2',
      tenant_id: TENANT,
      actor_id: 'user-1',
      action: 'service.update',
      resource_type: 'service',
      resource_id: SERVICE_ID,
      outcome: 'success',
      at: '2026-04-11T10:00:00Z',
      tier: 'write',
    },
    {
      // Should NOT appear — different service id.
      id: 'aud-fp-other',
      tenant_id: TENANT,
      actor_id: 'user-1',
      action: 'service.update',
      resource_type: 'service',
      resource_id: 'svc-OTHER',
      outcome: 'success',
      at: '2026-04-12T10:00:00Z',
      tier: 'write',
    },
  ];
  const existing = useMockStore.getState().audit;
  useMockStore.setState({ audit: [...existing, ...entries] });
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  // Wipe any seeded audit/routes so test fixtures are isolated.
  useMockStore.setState({ audit: [], routes: {} });
  seedMinimalRoutes();
  seedAuditForService();

  server.use(
    http.get(`*/api/v1/t/${TENANT}/services/${SERVICE_ID}`, () =>
      HttpResponse.json(makeProtoService()),
    ),
    http.get(`*/api/v1/t/${TENANT}/services`, () =>
      HttpResponse.json<ListServices200>({ items: [makeProtoService()], total: 1 }),
    ),
  );
});

describe('<ServiceFullPage>', () => {
  it('renders all four tabs once the service loads', async () => {
    renderWithProviders(<ServiceFullPage tenantId={TENANT} serviceId={SERVICE_ID} />);

    // Wait for the real-endpoint hook to populate.
    await waitFor(() => {
      expect(screen.getByTestId('service-fullpage')).toBeInTheDocument();
    });

    expect(screen.getByTestId('service-fullpage-tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('service-fullpage-tab-routes')).toBeInTheDocument();
    expect(screen.getByTestId('service-fullpage-tab-health')).toBeInTheDocument();
    expect(screen.getByTestId('service-fullpage-tab-audit')).toBeInTheDocument();
  });

  it('Overview tab is the default and shows upstream + tags', async () => {
    renderWithProviders(<ServiceFullPage tenantId={TENANT} serviceId={SERVICE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('service-fullpage-panel-overview')).toBeInTheDocument();
    });

    const overview = screen.getByTestId('service-fullpage-panel-overview');
    expect(within(overview).getByText('http://backend:8080')).toBeInTheDocument();
    expect(within(overview).getByText(/critical, public/)).toBeInTheDocument();
  });

  it('Routes tab shows routes attached to the service', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServiceFullPage tenantId={TENANT} serviceId={SERVICE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('service-fullpage-tab-routes')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('service-fullpage-tab-routes'));

    const panel = await screen.findByTestId('service-fullpage-panel-routes');
    const table = within(panel).getByTestId('service-fullpage-routes-table');
    expect(within(table).getByText('list-users')).toBeInTheDocument();
    expect(within(table).getByText('create-user')).toBeInTheDocument();
    expect(within(table).getByText('GET')).toBeInTheDocument();
    expect(within(table).getByText('POST')).toBeInTheDocument();
  });

  it('Health tab shows the health status and force-reload action', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServiceFullPage tenantId={TENANT} serviceId={SERVICE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('service-fullpage-tab-health')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('service-fullpage-tab-health'));

    const panel = await screen.findByTestId('service-fullpage-panel-health');
    expect(within(panel).getByText(/Status:/)).toBeInTheDocument();
    expect(within(panel).getByText(/GET \/healthz/)).toBeInTheDocument();
    expect(within(panel).getByTestId('service-fullpage-force-reload')).toBeInTheDocument();
  });

  it('Audit tab loads audit entries filtered by the service id', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServiceFullPage tenantId={TENANT} serviceId={SERVICE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('service-fullpage-tab-audit')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('service-fullpage-tab-audit'));

    const panel = await screen.findByTestId('service-fullpage-panel-audit');
    const table = within(panel).getByTestId('service-fullpage-audit-table');
    // Two entries match this service; the third (svc-OTHER) must not appear.
    expect(within(table).getByText('service.create')).toBeInTheDocument();
    expect(within(table).getAllByText('service.update').length).toBe(1);
    expect(within(table).queryByText(/svc-OTHER/i)).not.toBeInTheDocument();
  });

  it('renders not-found state when the service hook returns nothing', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/services/missing`, () =>
        HttpResponse.json({}, { status: 404 }),
      ),
    );

    renderWithProviders(<ServiceFullPage tenantId={TENANT} serviceId="missing" />);

    await waitFor(() => {
      expect(screen.getByTestId('service-fullpage-not-found')).toBeInTheDocument();
    });
  });
});
