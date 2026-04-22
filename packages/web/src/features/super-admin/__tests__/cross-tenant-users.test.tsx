/**
 * Tests for <CrossTenantUsers>
 * Task 1d.78
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
import { CrossTenantUsers } from '../components/cross-tenant-users';

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

describe('CrossTenantUsers', () => {
  it('renders seeded users across all tenants', () => {
    wrap(<CrossTenantUsers />);
    // Should show at least some rows
    const rows = screen.getAllByRole('row');
    // header + data rows
    expect(rows.length).toBeGreaterThan(5);
  });

  it('renders tenant filter dropdown', () => {
    wrap(<CrossTenantUsers />);
    // The "All tenants" label appears in the tenant filter select
    expect(screen.getByText(/all tenants/i)).toBeDefined();
  });

  it('renders state filter dropdown', () => {
    wrap(<CrossTenantUsers />);
    expect(screen.getByText(/all states/i)).toBeDefined();
  });

  it('renders search input', () => {
    wrap(<CrossTenantUsers />);
    expect(screen.getByPlaceholderText(/search by name or email/i)).toBeDefined();
  });
});
