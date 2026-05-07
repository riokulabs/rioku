/**
 * Unit tests for <ServiceDetail>.
 *
 * Stage 2: <ServiceDetail> resolves the service via `useServiceDetail`,
 * which is real-endpoint backed. Tests stub the daemon
 * `GET /api/v1/t/{tenant}/services/{id}` endpoint with MSW.
 *
 * Audit / middlewares / policies / routes panels still read from the
 * mock store (those slices are owned by sibling plans), so we still
 * call `seedStore()` for that supporting state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import type { V1Service } from '@/api/generated/schemas';
import { ServiceDetail } from '../components/detail';
import { LBL_ENV, LBL_PROTOCOL, LBL_TAGS } from '../adapter';

const TENANT = 'tenant-detail-1';
const SERVICE_ID = 'svc-detail-1';

function makeProtoService(overrides: Partial<V1Service> = {}): V1Service {
  return {
    id: SERVICE_ID,
    name: 'detail-api',
    upstreams: [{ address: 'http://detail:8080', healthy: true }],
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
        <Notifications />
        <ModalsProvider>{ui}</ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  server.use(
    http.get(`*/api/v1/t/${TENANT}/services/${SERVICE_ID}`, () =>
      HttpResponse.json(makeProtoService()),
    ),
  );
});

describe('ServiceDetail', () => {
  it('renders the service header + upstream + routes sections', async () => {
    wrap(
      <ServiceDetail
        serviceId={SERVICE_ID}
        tenantId={TENANT}
        onEdit={vi.fn()}
        onSelectRoute={vi.fn()}
        onEditRoute={vi.fn()}
        onDeleteRoute={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByText('detail-api').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/upstream/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/routes/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/middlewares in use/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/policies in use/i).length).toBeGreaterThan(0);
  });

  it('renders the not-found alert when the daemon does not return the service', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/services/missing-id`, () =>
        HttpResponse.json({}, { status: 404 }),
      ),
    );
    wrap(
      <ServiceDetail
        serviceId="missing-id"
        tenantId={TENANT}
        onEdit={vi.fn()}
        onSelectRoute={vi.fn()}
        onEditRoute={vi.fn()}
        onDeleteRoute={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/service not found/i)).toBeInTheDocument();
    });
  });
});
