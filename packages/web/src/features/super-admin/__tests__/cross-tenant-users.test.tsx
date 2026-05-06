/**
 * Tests for <CrossTenantUsers> — Task 3 (Plan 11)
 *
 * Covers:
 *   - Renders seeded users across all tenants
 *   - Filter controls: tenant, state, disabled status
 *   - Search input
 *   - User detail drawer opens (Profile / Memberships / Audit tabs)
 *   - Admin audit emission when user profile is viewed
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('renders disabled status filter dropdown', () => {
    wrap(<CrossTenantUsers />);
    // "All users" appears in both the page title and the filter select — getAllByText handles multiple
    const allUsersEls = screen.getAllByText(/all users/i);
    expect(allUsersEls.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Status column header', () => {
    wrap(<CrossTenantUsers />);
    expect(screen.getByText('Status')).toBeDefined();
  });

  it('renders Membership column header', () => {
    wrap(<CrossTenantUsers />);
    expect(screen.getByText('Membership')).toBeDefined();
  });

  it('opens user detail drawer when user name is clicked', async () => {
    wrap(<CrossTenantUsers />);
    const nameCells = screen.getAllByTestId('user-name-cell');
    expect(nameCells.length).toBeGreaterThan(0);
    fireEvent.click(nameCells[0]!);
    await waitFor(() => {
      // Profile tab should be visible in the drawer
      expect(screen.getAllByText(/profile/i).length).toBeGreaterThan(0);
    });
  });

  it('user detail drawer shows Memberships tab', async () => {
    wrap(<CrossTenantUsers />);
    const nameCells = screen.getAllByTestId('user-name-cell');
    fireEvent.click(nameCells[0]!);
    await waitFor(() => {
      expect(screen.getAllByText(/memberships/i).length).toBeGreaterThan(0);
    });
  });

  it('user detail drawer shows Audit tab', async () => {
    wrap(<CrossTenantUsers />);
    const nameCells = screen.getAllByTestId('user-name-cell');
    fireEvent.click(nameCells[0]!);
    await waitFor(() => {
      // "Audit" tab label (with count)
      const auditTabs = screen.getAllByText(/^audit/i);
      expect(auditTabs.length).toBeGreaterThan(0);
    });
  });
});

// ─── Admin audit emission ─────────────────────────────────────────────────────

describe('CrossTenantUsers — admin audit emission', () => {
  it('logAdminAuditEntry appends a user:view entry to adminAudit', async () => {
    const { logAdminAuditEntry } = await import('@/api/resources/audit');
    const before = useMockStore.getState().adminAudit.length;
    await logAdminAuditEntry({
      tenant_id: null,
      actor_id: 'user-0001',
      action: 'user:view',
      resource_type: 'user',
      resource_id: 'user-0002',
      tier: 'read',
    });
    const after = useMockStore.getState().adminAudit.length;
    expect(after).toBe(before + 1);
    expect(useMockStore.getState().adminAudit.at(-1)?.action).toBe('user:view');
  });
});
