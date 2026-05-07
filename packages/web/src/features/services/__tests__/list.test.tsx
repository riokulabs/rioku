/**
 * Unit tests for <ServiceList> + <ServiceFilterBar>.
 *
 * Stage 2: <ServiceList> is real-endpoint backed via `useServiceListReal`.
 * Tests stub the daemon `GET /api/v1/t/{tenant}/services` endpoint with MSW
 * and verify the list renders the response. The filter-bar is a pure
 * controlled component so it does not need any HTTP setup.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import type { ListServices200, V1Service } from '@/api/generated/schemas';
import { ServiceList } from '../components/list';
import { ServiceFilterBar } from '../components/filter-bar';
import type { ServiceFilter } from '../types';
import { LBL_ENV, LBL_PROTOCOL, LBL_TAGS } from '../adapter';

const TENANT = 'tenant-list-1';

function makeProtoService(overrides: Partial<V1Service> = {}): V1Service {
  return {
    id: 'svc-1',
    name: 'fixture',
    upstreams: [{ address: 'http://up:8080', healthy: true }],
    labels: {
      labels: { [LBL_ENV]: 'production', [LBL_PROTOCOL]: 'http', [LBL_TAGS]: '' },
    },
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <ModalsProvider>{ui}</ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const DEFAULT_FILTER: ServiceFilter = {
  search: '',
  health: [],
  env: [],
  tags: [],
};

beforeEach(() => {
  server.use(
    http.get(`*/api/v1/t/${TENANT}/services`, () =>
      HttpResponse.json<ListServices200>({
        items: [
          makeProtoService({ id: 'svc-1', name: 'auth-api' }),
          makeProtoService({
            id: 'svc-2',
            name: 'billing-api',
            upstreams: [{ address: 'http://billing:8080', healthy: false }],
          }),
        ],
        total: 2,
      }),
    ),
  );
});

describe('ServiceList', () => {
  it('renders services from the daemon list endpoint', async () => {
    wrap(
      <ServiceList
        tenantId={TENANT}
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onForceReload={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('auth-api')).toBeInTheDocument();
    });
    expect(screen.getByText('billing-api')).toBeInTheDocument();
  });

  it('fires onSelect when a row is clicked', async () => {
    const onSelect = vi.fn();
    wrap(
      <ServiceList
        tenantId={TENANT}
        filter={DEFAULT_FILTER}
        onSelect={onSelect}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onForceReload={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('auth-api')).toBeInTheDocument();
    });
    const dataRows = screen.getAllByRole('row').slice(1);
    const firstRow = dataRows[0];
    if (!firstRow) throw new Error('No data rows');
    fireEvent.click(firstRow);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('shows empty state when the daemon returns no services', async () => {
    server.use(
      http.get(`*/api/v1/t/empty-tenant/services`, () =>
        HttpResponse.json<ListServices200>({ items: [], total: 0 }),
      ),
    );
    wrap(
      <ServiceList
        tenantId="empty-tenant"
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onForceReload={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByText(/no services/i).length).toBeGreaterThan(0);
    });
  });
});

describe('ServiceFilterBar', () => {
  it('renders search, env, health, and tag filter controls', () => {
    wrap(
      <ServiceFilterBar
        filter={DEFAULT_FILTER}
        onChange={vi.fn()}
        envOptions={['production', 'staging']}
        tagOptions={['auth', 'billing']}
      />,
    );
    expect(screen.getAllByLabelText('Filter by health').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Filter by environment').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Filter by tag').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Search services').length).toBeGreaterThan(0);
  });
});
