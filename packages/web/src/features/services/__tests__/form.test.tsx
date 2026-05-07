/**
 * Unit tests for <ServiceForm>.
 *
 * Stage 2: <ServiceForm> calls `createService(tenantId, …)` /
 * `updateService(tenantId, id, …)` which dispatch directly against the
 * Orval-generated client. Tests stub the daemon endpoints with MSW.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

vi.mock('@/hooks/use-permission', () => ({
  usePermission: () => true,
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
import { ServiceForm } from '../components/form';
import { LBL_ENV, LBL_PROTOCOL, LBL_TAGS } from '../adapter';

const TENANT = 'tenant-form-1';

function makeProtoService(overrides: Partial<V1Service> = {}): V1Service {
  return {
    id: 'svc-form-1',
    name: 'created-api',
    upstreams: [{ address: 'http://test:8080', healthy: true }],
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
});

function nameInput(): HTMLInputElement {
  return screen.getByPlaceholderText('auth-api');
}

function upstreamInput(): HTMLInputElement {
  return screen.getByPlaceholderText('http://upstream:8080');
}

describe('ServiceForm (create)', () => {
  it('renders name, upstream, and a Create button', () => {
    wrap(<ServiceForm mode="create" tenantId={TENANT} onSuccess={vi.fn()} onCancel={vi.fn()} />);
    expect(nameInput()).toBeInTheDocument();
    expect(upstreamInput()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create service/i })).toBeInTheDocument();
  });

  it('shows validation error on empty name submit', async () => {
    wrap(<ServiceForm mode="create" tenantId={TENANT} onSuccess={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /create service/i }));
    await waitFor(() => {
      const errors = screen.queryAllByText(/required|name|least|small/i);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  it('submits successfully and calls onSuccess when the daemon accepts', async () => {
    server.use(
      http.post(`*/api/v1/t/${TENANT}/services`, () =>
        HttpResponse.json(makeProtoService(), { status: 201 }),
      ),
    );
    const onSuccess = vi.fn();
    wrap(
      <ServiceForm mode="create" tenantId={TENANT} onSuccess={onSuccess} onCancel={vi.fn()} />,
    );
    fireEvent.change(nameInput(), { target: { value: 'created-api' } });
    fireEvent.change(upstreamInput(), { target: { value: 'http://test:8080' } });
    fireEvent.click(screen.getByRole('button', { name: /create service/i }));
    await waitFor(
      () => {
        expect(onSuccess).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
  });
});

describe('ServiceForm (edit)', () => {
  it('pre-fills fields from initialValues', () => {
    const svc = Object.values(useMockStore.getState().services)[0];
    if (!svc) throw new Error('no seeded service');

    wrap(
      <ServiceForm
        mode="edit"
        tenantId={TENANT}
        initialValues={svc}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(nameInput().value).toBe(svc.name);
    expect(upstreamInput().value).toBe(svc.upstream);
  });
});
