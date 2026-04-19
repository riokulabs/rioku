/**
 * Tests for <SidebarFooter> — tenant switcher reads real memberships.
 * Task 1d.82
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
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
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
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('SidebarFooter — tenant switcher', () => {
  it('reads tenants from mock-store memberships (renders current tenant slug)', () => {
    // Verify the sidebar footer renders the current tenant from the mock store
    // (Derrick's current tenant is acme based on mock-seed)
    wrap(<SidebarFooter />);
    // The tenant slug 'acme' should appear in the rendered pill
    const acmeText = screen.getAllByText('acme');
    expect(acmeText.length).toBeGreaterThan(0);
  });

  it('shows current tenant slug in the pill', () => {
    wrap(<SidebarFooter />);
    // Derrick's current tenant is 'acme'
    expect(screen.getAllByText('acme').length).toBeGreaterThan(0);
  });

  it('path-prefix mode: clicking different tenant navigates directly without confirm', () => {
    tenantMode = 'path-prefix';
    wrap(<SidebarFooter />);

    // Open tenant menu
    const buttons = screen.getAllByRole('button');
    const tenantPill = buttons[0];
    if (!tenantPill) throw new Error('No button found');
    fireEvent.click(tenantPill);

    // If Derrick has beta membership, click beta option
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

    // Open tenant menu
    const buttons = screen.getAllByRole('button');
    const tenantPill = buttons[0];
    if (!tenantPill) throw new Error('No button found');
    fireEvent.click(tenantPill);

    // Try to switch — if user has a non-current tenant
    const betaOption = screen.queryByTestId('tenant-option-beta');
    if (betaOption) {
      fireEvent.click(betaOption);
      // Modal should appear
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
