/**
 * Unit tests for <AgentList> + <AgentFilterBar>.
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
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { AgentList } from '../components/list';
import { AgentFilterBar } from '../components/filter-bar';
import type { AgentFilter } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

const DEFAULT_FILTER: AgentFilter = {
  search: '',
  provider_ids: [],
  role_ids: [],
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

describe('AgentList', () => {
  it('renders seeded agents for the acme tenant', () => {
    wrap(
      <AgentList
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onInvoke={vi.fn()}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('shows empty state when tenant has no agents', () => {
    wrap(
      <AgentList
        tenantId="nonexistent-tenant-id"
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onInvoke={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/no agents/i).length).toBeGreaterThan(0);
  });
});

describe('AgentFilterBar', () => {
  it('renders search, provider, role, and enabled controls', () => {
    wrap(<AgentFilterBar tenantId={acmeId()} filter={DEFAULT_FILTER} onChange={vi.fn()} />);
    expect(screen.getAllByLabelText('Search agents').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Filter by provider').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Filter by role').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Filter by enabled').length).toBeGreaterThan(0);
  });
});
