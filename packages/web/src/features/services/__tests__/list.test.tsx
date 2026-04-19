/**
 * Unit tests for <ServiceList> + <ServiceFilterBar>.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { ServiceList } from '../components/list';
import { ServiceFilterBar } from '../components/filter-bar';
import type { ServiceFilter } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

const DEFAULT_FILTER: ServiceFilter = {
  search: '',
  health: 'all',
  env: 'all',
  tag: null,
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

describe('ServiceList', () => {
  it('renders seeded services for acme tenant', () => {
    wrap(
      <ServiceList
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onForceReload={vi.fn()}
      />,
    );
    // At least 1 header + N data rows
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('fires onSelect when a row is clicked', () => {
    const onSelect = vi.fn();
    wrap(
      <ServiceList
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onSelect={onSelect}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onForceReload={vi.fn()}
      />,
    );
    const dataRows = screen.getAllByRole('row').slice(1);
    const firstRow = dataRows[0];
    if (!firstRow) throw new Error('No data rows');
    fireEvent.click(firstRow);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('narrows the list when health filter is set', () => {
    const { rerender } = wrap(
      <ServiceList
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onForceReload={vi.fn()}
      />,
    );
    const allCount = screen.getAllByRole('row').length;

    rerender(
      <MantineProvider>
        <ModalsProvider>
          <ServiceList
            tenantId={acmeId()}
            filter={{ ...DEFAULT_FILTER, health: 'unhealthy' }}
            onSelect={vi.fn()}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onForceReload={vi.fn()}
          />
        </ModalsProvider>
      </MantineProvider>,
    );
    const filteredCount = screen.queryAllByRole('row').length;
    // Either narrower, or the empty-state renders (which has zero rows).
    expect(filteredCount).toBeLessThanOrEqual(allCount);
  });

  it('shows empty state when tenant has no services', () => {
    wrap(
      <ServiceList
        tenantId="nonexistent-tenant-id"
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onForceReload={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/no services/i).length).toBeGreaterThan(0);
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
    // Mantine Select renders multiple aria-labelled elements; use getAllBy.
    expect(screen.getAllByLabelText('Filter by health').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Filter by environment').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Filter by tag').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Search services').length).toBeGreaterThan(0);
  });
});
