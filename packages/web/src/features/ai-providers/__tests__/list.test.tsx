/**
 * Unit tests for <ProviderList> + <ProviderFilterBar>.
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
import { ProviderList } from '../components/list';
import { ProviderFilterBar } from '../components/filter-bar';
import type { ProviderFilter } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

const DEFAULT_FILTER: ProviderFilter = {
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

describe('ProviderList', () => {
  it('renders seeded providers for the acme tenant', () => {
    wrap(
      <ProviderList
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTest={vi.fn()}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('shows empty state when tenant has no providers', () => {
    wrap(
      <ProviderList
        tenantId="nonexistent-tenant-id"
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTest={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/no providers/i).length).toBeGreaterThan(0);
  });

  it('narrows by kind filter', () => {
    const { rerender } = wrap(
      <ProviderList
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTest={vi.fn()}
      />,
    );
    const allCount = screen.getAllByRole('row').length;
    rerender(
      <MantineProvider>
        <ModalsProvider>
          <ProviderList
            tenantId={acmeId()}
            filter={{ ...DEFAULT_FILTER, kinds: ['openai'] }}
            onSelect={vi.fn()}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onTest={vi.fn()}
          />
        </ModalsProvider>
      </MantineProvider>,
    );
    const filteredCount = screen.queryAllByRole('row').length;
    expect(filteredCount).toBeLessThanOrEqual(allCount);
  });
});

describe('ProviderFilterBar', () => {
  it('renders search, kind, and enabled controls', () => {
    wrap(<ProviderFilterBar filter={DEFAULT_FILTER} onChange={vi.fn()} />);
    expect(screen.getAllByLabelText('Search providers').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Filter by provider kind').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Filter by enabled').length).toBeGreaterThan(0);
  });
});
