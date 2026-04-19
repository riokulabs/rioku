/**
 * Unit tests for <ProviderDetail>.
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
import { ProviderDetail } from '../components/detail';

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

function firstProviderId(): string {
  const state = useMockStore.getState();
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  const p = Object.values(state.aiProviders).find(
    (pr) => pr.tenant_id === acme.id,
  );
  if (!p) throw new Error('No provider seeded');
  return p.id;
}

describe('ProviderDetail', () => {
  it('renders provider header + credential + models section', () => {
    const id = firstProviderId();
    wrap(
      <ProviderDetail
        providerId={id}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/Base URL/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Credential/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Models/i).length).toBeGreaterThan(0);
  });

  it('shows error alert when provider not found', () => {
    wrap(
      <ProviderDetail
        providerId="does-not-exist"
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Provider not found/i)).toBeInTheDocument();
  });
});
