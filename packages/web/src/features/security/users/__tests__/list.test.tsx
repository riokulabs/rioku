/**
 * Unit tests for <UserList>.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({
    navigate: vi.fn(),
  }),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { UserList } from '../components/list';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('UserList', () => {
  it('renders users with memberships for acme tenant', () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant seeded');

    const onSelect = vi.fn();
    wrap(<UserList tenantId={acmeTenant.id} tenantSlug="acme" onSelect={onSelect} />);

    // Acme has 6 members (derrick + users 1-4 + user 11 + user 14)
    const rows = screen.getAllByRole('row');
    // At least 1 header + at least 6 data rows
    expect(rows.length).toBeGreaterThanOrEqual(7);
  });

  it('calls onSelect when a row is clicked', () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant seeded');

    const onSelect = vi.fn();
    wrap(<UserList tenantId={acmeTenant.id} tenantSlug="acme" onSelect={onSelect} />);

    const dataRows = screen.getAllByRole('row').slice(1);
    const firstRow = dataRows[0];
    if (!firstRow) throw new Error('No data rows found');
    fireEvent.click(firstRow);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('shows empty state when no users match tenant', () => {
    const onSelect = vi.fn();
    wrap(<UserList tenantId="nonexistent-tenant-id" tenantSlug="none" onSelect={onSelect} />);
    expect(screen.getAllByText(/No users yet/i).length).toBeGreaterThan(0);
  });

  it('renders status dropdown', () => {
    const state = useMockStore.getState();
    const acmeTenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acmeTenant) throw new Error('No acme tenant seeded');

    const onSelect = vi.fn();
    wrap(<UserList tenantId={acmeTenant.id} tenantSlug="acme" onSelect={onSelect} />);

    // Status dropdown is present (getAllByLabelText because Mantine renders multiple aria elements)
    expect(screen.getAllByLabelText(/Filter by membership status/i).length).toBeGreaterThan(0);
  });
});
