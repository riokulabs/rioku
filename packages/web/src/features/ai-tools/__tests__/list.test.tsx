/**
 * Unit tests for <ToolList> + <ToolFilterBar>.
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
import { ToolList } from '../components/list';
import { ToolFilterBar } from '../components/filter-bar';
import type { ToolFilter } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

const DEFAULT_FILTER: ToolFilter = {
  search: '',
  kinds: [],
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

describe('ToolList', () => {
  it('renders seeded tools for the acme tenant', () => {
    wrap(
      <ToolList
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('shows empty state when tenant has no tools', () => {
    wrap(
      <ToolList
        tenantId="nonexistent-tenant-id"
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/no tools/i).length).toBeGreaterThan(0);
  });
});

describe('ToolFilterBar', () => {
  it('renders search, kind, dangerous, and enabled controls', () => {
    wrap(<ToolFilterBar filter={DEFAULT_FILTER} onChange={vi.fn()} />);
    expect(screen.getAllByLabelText('Search tools').length).toBeGreaterThan(0);
    expect(
      screen.getAllByLabelText('Filter by tool kind').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByLabelText('Filter by dangerous').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByLabelText('Filter by enabled').length,
    ).toBeGreaterThan(0);
  });
});
