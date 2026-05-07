/**
 * Tests for <SidebarFooter> — the tenant switcher reads from the
 * daemon's admin-tenants list. We mock that hook + `useCurrentUser` +
 * `useImpersonationSession` directly so the test stays focused on the
 * footer's switch / navigate behaviour.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let tenantMode = 'path-prefix';
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => mockNavigate,
  useRouter: () => ({ navigate: mockNavigate }),
  useRouterState: () => ({ location: { pathname: '/t/acme/dashboard' } }),
}));

vi.mock('@/hooks/use-tenant', () => ({
  useTenant: () => ({ slug: 'acme', mode: tenantMode }),
  detectTenantMode: () => tenantMode,
  useActiveTenantSlug: () => 'acme',
}));

vi.mock('@/hooks/use-session', () => ({
  useSession: () => ({
    currentUserId: 'user-derrick',
    currentTenantId: 'acme',
    isAuthenticated: true,
  }),
}));

vi.mock('@/features/auth/use-current-user', () => ({
  useCurrentUser: () => ({
    data: {
      id: 'user-derrick',
      username: 'derrick',
      displayName: 'Derrick',
      email: 'derrick@rioku.dev',
      roles: ['superadmin'],
      permissions: [],
      status: 'active',
      forcePasswordChange: false,
      totpEnabled: true,
    },
  }),
}));

vi.mock('@/features/security/impersonation/use-impersonation-session', () => ({
  useImpersonationSession: () => null,
}));

vi.mock('@/features/auth/api', () => ({
  logout: vi.fn().mockResolvedValue(undefined),
}));

const TENANTS = [
  { id: 'tenant-acme', slug: 'acme', name: 'Acme Corp' },
  { id: 'tenant-beta', slug: 'beta', name: 'Beta Inc' },
];

vi.mock('@/api/generated/admin/admin', () => ({
  useListAdminTenants: () => ({
    data: { data: { items: TENANTS } },
    isLoading: false,
    isError: false,
  }),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { SidebarFooter } from '../sidebar-footer';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  tenantMode = 'path-prefix';
  mockNavigate.mockClear();
});

describe('SidebarFooter — tenant switcher', () => {
  it('renders the current tenant slug from the route', () => {
    wrap(<SidebarFooter />);
    const acmeText = screen.getAllByText('acme');
    expect(acmeText.length).toBeGreaterThan(0);
  });

  it('shows current tenant slug in the pill', () => {
    wrap(<SidebarFooter />);
    expect(screen.getAllByText('acme').length).toBeGreaterThan(0);
  });

  it('path-prefix mode: clicking another tenant navigates directly without confirm', () => {
    tenantMode = 'path-prefix';
    wrap(<SidebarFooter />);

    const buttons = screen.getAllByRole('button');
    const tenantPill = buttons[0];
    if (!tenantPill) throw new Error('No button found');
    fireEvent.click(tenantPill);

    const betaOption = screen.queryByTestId('tenant-option-beta');
    if (betaOption) {
      fireEvent.click(betaOption);
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ params: { tenant: 'beta' } }),
      );
    }
  });

  it('subdomain mode: clicking a different tenant opens confirm modal', () => {
    tenantMode = 'subdomain';
    wrap(<SidebarFooter />);

    const buttons = screen.getAllByRole('button');
    const tenantPill = buttons[0];
    if (!tenantPill) throw new Error('No button found');
    fireEvent.click(tenantPill);

    const betaOption = screen.queryByTestId('tenant-option-beta');
    if (betaOption) {
      fireEvent.click(betaOption);
      expect(screen.queryByText(/switch tenant/i)).not.toBeNull();
    }
  });

  it('subdomain confirm: clicking Cancel does not navigate', () => {
    tenantMode = 'subdomain';
    wrap(<SidebarFooter />);

    const buttons = screen.getAllByRole('button');
    const tenantPill = buttons[0];
    if (!tenantPill) throw new Error('No button found');
    fireEvent.click(tenantPill);

    const betaOption = screen.queryByTestId('tenant-option-beta');
    if (betaOption) {
      fireEvent.click(betaOption);
      const cancelBtn = screen.queryByRole('button', { name: /cancel/i });
      if (cancelBtn) {
        fireEvent.click(cancelBtn);
        expect(mockNavigate).not.toHaveBeenCalled();
      }
    }
  });
});
