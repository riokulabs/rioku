/**
 * Tests for <SettingsLayout>
 * Task 1d.79
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockSection: string | undefined = undefined;
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ section: mockSection }),
  useNavigate: () => mockNavigate,
  useRouter: () => ({ navigate: mockNavigate }),
  // SettingsLayout renders a <Link> for the notifications sub-route after
  // Plan 7c. Stub it with a plain anchor so the layout test doesn't need the
  // full TanStack Router runtime.
  Link: ({
    children,
    to: _to,
    params: _params,
    ...rest
  }: React.PropsWithChildren<{ to: string; params?: Record<string, string> }> &
    Record<string, unknown>) => <a {...rest}>{children}</a>,
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { SettingsLayout } from '../components/settings-layout';

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

beforeEach(() => {
  mockSection = undefined;
  mockNavigate.mockClear();
});

describe('SettingsLayout', () => {
  it('renders 11 subnav sections', () => {
    wrap(<SettingsLayout />);
    const navItems = screen.getAllByTestId(/settings-nav-/);
    expect(navItems.length).toBe(11);
  });

  it('shows profile section placeholder by default (no ?section param)', () => {
    wrap(<SettingsLayout />);
    expect(screen.getByText(/profile settings/i)).toBeDefined();
    expect(screen.getByText(/plan 1e/i)).toBeDefined();
  });

  it('shows tenant section when ?section=tenant', () => {
    mockSection = 'tenant';
    wrap(<SettingsLayout />);
    expect(screen.getByText(/tenant settings/i)).toBeDefined();
  });

  it('shows notifications section with link to the notifications subpage', () => {
    mockSection = 'notifications';
    wrap(<SettingsLayout />);
    // Plan 7 switched notifications from an EmptyState to a live sub-route,
    // so the layout now renders an "Open notifications" anchor + plan label.
    expect(screen.getByTestId('settings-section-open-notifications')).toBeDefined();
    expect(screen.getByText(/plan 7/i)).toBeDefined();
  });

  it('shows network section with Plan 8 label', () => {
    mockSection = 'network';
    wrap(<SettingsLayout />);
    expect(screen.getByText(/network settings/i)).toBeDefined();
    expect(screen.getByText(/plan 8/i)).toBeDefined();
  });

  it('calls navigate when subnav item is clicked', () => {
    wrap(<SettingsLayout />);
    const tenantNav = screen.getByTestId('settings-nav-tenant');
    fireEvent.click(tenantNav);
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('renders all expected section nav items', () => {
    wrap(<SettingsLayout />);
    const expectedSlugs = [
      'profile', 'tenant', 'authentication', 'notifications',
      'network', 'pki', 'tls', 'observability', 'integrations',
      'plugins', 'danger-zone',
    ];
    for (const slug of expectedSlugs) {
      expect(screen.getByTestId(`settings-nav-${slug}`)).toBeDefined();
    }
  });
});
