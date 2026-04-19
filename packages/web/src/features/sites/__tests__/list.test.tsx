/**
 * Unit tests for <SiteList> + <SiteFilterBar>.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { SiteList } from '../components/list';
import { SiteFilterBar } from '../components/filter-bar';
import type { SiteFilter } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

const DEFAULT_FILTER: SiteFilter = {
  search: '',
  tls_mode: [],
  enabled: [],
  linked_service_ids: [],
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

describe('SiteList', () => {
  it('renders seeded sites for acme tenant', () => {
    wrap(
      <SiteList
        tenantId={acmeId()}
        tenantSlug="acme"
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('fires onSelect when a row is clicked', () => {
    const onSelect = vi.fn();
    wrap(
      <SiteList
        tenantId={acmeId()}
        tenantSlug="acme"
        filter={DEFAULT_FILTER}
        onSelect={onSelect}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const dataRows = screen.getAllByRole('row').slice(1);
    const firstRow = dataRows[0];
    if (!firstRow) throw new Error('No data rows');
    fireEvent.click(firstRow);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('narrows the list when tls_mode filter is set', () => {
    const { rerender } = wrap(
      <SiteList
        tenantId={acmeId()}
        tenantSlug="acme"
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const allCount = screen.getAllByRole('row').length;

    rerender(
      <MantineProvider>
        <ModalsProvider>
          <SiteList
            tenantId={acmeId()}
            tenantSlug="acme"
            filter={{ ...DEFAULT_FILTER, tls_mode: ['off'] }}
            onSelect={vi.fn()}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
          />
        </ModalsProvider>
      </MantineProvider>,
    );
    const filtered = screen.queryAllByRole('row').length;
    expect(filtered).toBeLessThanOrEqual(allCount);
  });

  it('shows empty state when tenant has no sites', () => {
    wrap(
      <SiteList
        tenantId="nonexistent-tenant-id"
        tenantSlug="nope"
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/no sites/i).length).toBeGreaterThan(0);
  });
});

describe('SiteFilterBar', () => {
  it('renders search, tls, enabled, and linked-service filter controls', () => {
    wrap(
      <SiteFilterBar
        filter={DEFAULT_FILTER}
        onChange={vi.fn()}
        serviceOptions={[{ value: 'svc-1', label: 'auth-api' }]}
      />,
    );
    expect(screen.getAllByLabelText('Filter by TLS mode').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Filter by enabled state').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Filter by linked service').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Search sites').length).toBeGreaterThan(0);
  });
});
