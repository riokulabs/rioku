/**
 * Unit tests for routes components — list, form, detail, middleware-stack-editor.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { RouteList } from '../components/list';
import { RouteForm } from '../components/form';
import { RouteDetail } from '../components/detail';
import { MiddlewareStackEditor } from '../components/middleware-stack-editor';
import type { RouteFilter } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

const DEFAULT_FILTER: RouteFilter = {
  search: '',
  method: 'all',
  enabled: 'all',
};

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function acmeId(): string {
  const state = useMockStore.getState();
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  return acme.id;
}

describe('RouteList', () => {
  it('renders seeded routes for a tenant', () => {
    wrap(
      <RouteList
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const rows = screen.queryAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('fires onSelect on row click', () => {
    const onSelect = vi.fn();
    wrap(
      <RouteList
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onSelect={onSelect}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const dataRows = screen.getAllByRole('row').slice(1);
    const firstRow = dataRows[0];
    if (!firstRow) throw new Error('no data rows');
    fireEvent.click(firstRow);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('RouteForm', () => {
  it('creates a route with a valid service_id + path', async () => {
    const state = useMockStore.getState();
    const svc = Object.values(state.services).find((s) => s.tenant_id === acmeId());
    if (!svc) throw new Error('no svc');

    const onSuccess = vi.fn();
    wrap(
      <RouteForm
        mode="create"
        tenantId={acmeId()}
        defaultServiceId={svc.id}
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('user-get'), {
      target: { value: 'test-route' },
    });
    fireEvent.change(screen.getByPlaceholderText('/api/users'), {
      target: { value: '/api/test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create route/i }));
    await waitFor(
      () => {
        expect(onSuccess).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
  });
});

describe('RouteDetail', () => {
  it('renders match info and sections', () => {
    const state = useMockStore.getState();
    const r = Object.values(state.routes).find(
      (rt) => state.services[rt.service_id]?.tenant_id === acmeId(),
    );
    if (!r) throw new Error('no route');

    wrap(<RouteDetail routeId={r.id} tenantId={acmeId()} onEdit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByText(/match/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/middleware stack/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/attached policies/i).length).toBeGreaterThan(0);
  });
});

/**
 * Seed a route with exactly two tenant middlewares attached so reorder tests
 * have a deterministic stack.
 */
function seedRouteWithTwoMiddlewares(): {
  routeId: string;
  a: string;
  b: string;
  aName: string;
  bName: string;
} {
  const state = useMockStore.getState();
  const tenantMids = Object.values(state.middlewares).filter((m) => m.tenant_id === acmeId());
  const a = tenantMids[0];
  const b = tenantMids[1];
  if (!a || !b) throw new Error('need at least 2 tenant middlewares');
  const route = Object.values(state.routes).find(
    (r) => state.services[r.service_id]?.tenant_id === acmeId(),
  );
  if (!route) throw new Error('no route');

  useMockStore.setState({
    routes: {
      ...state.routes,
      [route.id]: { ...route, middleware_ids: [a.id, b.id] },
    },
  });

  return { routeId: route.id, a: a.id, b: b.id, aName: a.name, bName: b.name };
}

describe('MiddlewareStackEditor', () => {
  it('disables up arrow on first item and down arrow on last', () => {
    const { routeId, aName, bName } = seedRouteWithTwoMiddlewares();
    wrap(<MiddlewareStackEditor routeId={routeId} tenantId={acmeId()} />);

    const upButton = screen.getByLabelText(`Move ${aName} up`);
    expect(upButton).toBeDisabled();

    const downButton = screen.getByLabelText(`Move ${bName} down`);
    expect(downButton).toBeDisabled();
  });

  it('reorders middlewares when down arrow is clicked on first item', async () => {
    const { routeId, a, aName } = seedRouteWithTwoMiddlewares();
    wrap(<MiddlewareStackEditor routeId={routeId} tenantId={acmeId()} />);

    const downButton = screen.getByLabelText(`Move ${aName} down`);
    fireEvent.click(downButton);

    await waitFor(
      () => {
        const updated = useMockStore.getState().routes[routeId];
        expect(updated?.middleware_ids[0]).not.toBe(a);
      },
      { timeout: 3000 },
    );
  });
});
