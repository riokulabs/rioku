/**
 * Unit tests for <ServiceDetail>.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { ServiceDetail } from '../components/detail';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

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

describe('ServiceDetail', () => {
  it('renders the service header + upstream + routes sections', () => {
    const state = useMockStore.getState();
    const svc = Object.values(state.services).find(
      (s) => s.tenant_id === acmeId(),
    );
    if (!svc) throw new Error('no service');

    wrap(
      <ServiceDetail
        serviceId={svc.id}
        tenantId={acmeId()}
        onEdit={vi.fn()}
        onSelectRoute={vi.fn()}
        onEditRoute={vi.fn()}
        onDeleteRoute={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText(svc.name).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/upstream/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/routes/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/middlewares in use/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/policies in use/i).length).toBeGreaterThan(0);
  });

  it('disables Delete button when routes still reference the service', () => {
    const state = useMockStore.getState();
    const svc = Object.values(state.services).find((s) =>
      Object.values(state.routes).some((r) => r.service_id === s.id),
    );
    if (!svc) throw new Error('no service with routes');

    wrap(
      <ServiceDetail
        serviceId={svc.id}
        tenantId={acmeId()}
        onEdit={vi.fn()}
        onSelectRoute={vi.fn()}
        onEditRoute={vi.fn()}
        onDeleteRoute={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    expect(deleteButton).toBeDisabled();
  });
});
