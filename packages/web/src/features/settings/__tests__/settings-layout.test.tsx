/**
 * Tests for <SettingsLayout>
 * Task 1d.79 (updated Task 8a.2: profile section now renders inline)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockSection: string | undefined = undefined;
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ section: mockSection }),
  useNavigate: () => mockNavigate,
  useRouter: () => ({ navigate: mockNavigate }),
  // SettingsLayout + ProfileSection render <Link> for sub-routes.
  // Stub with a plain anchor so tests don't need the full TanStack runtime.
  Link: ({
    children,
    to: _to,
    params: _params,
    ...rest
  }: React.PropsWithChildren<{ to: string; params?: Record<string, string> }> &
    Record<string, unknown>) => <a {...rest}>{children}</a>,
}));

// Stub usePermission — default grant everything in layout tests.
vi.mock('@/hooks/use-permission', () => ({
  usePermission: () => true,
}));

// Stub useActiveTheme used by ProfilePreferences.
vi.mock('@/hooks/use-active-theme', () => ({
  useActiveTheme: () => ['dark', vi.fn()] as [string, (v: string) => void],
}));

// Stub Monaco editor — lazy-loaded by NetworkSection.
vi.mock('@monaco-editor/react', () => {
  const MockEditor = ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (v: string | undefined) => void;
  }) => (
    <textarea
      data-testid="monaco-stub"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
  return { default: MockEditor };
});

// Stub @mantine/dropzone — used by ProfilePersonalInfo and TenantSection.
// jsdom lacks ResizeObserver + File API internals required by the real Dropzone.
function DropzoneStub({
  children,
  onDrop: _onDrop,
  ...rest
}: React.PropsWithChildren<Record<string, unknown>>) {
  const testId = (rest['data-testid'] as string | undefined) ?? 'dropzone-stub';
  return <div data-testid={testId} {...rest}>{children}</div>;
}
function NoopChild({ children }: React.PropsWithChildren) {
  return <>{children}</>;
}
DropzoneStub.Accept = NoopChild;
DropzoneStub.Reject = NoopChild;
DropzoneStub.Idle = NoopChild;

vi.mock('@mantine/dropzone', () => ({
  Dropzone: DropzoneStub,
  IMAGE_MIME_TYPE: ['image/png', 'image/jpeg'],
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { SettingsLayout } from '../components/settings-layout';

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

beforeEach(() => {
  mockSection = undefined;
  mockNavigate.mockClear();
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('SettingsLayout', () => {
  it('renders 11 subnav sections', () => {
    wrap(<SettingsLayout />);
    const navItems = screen.getAllByTestId(/settings-nav-/);
    expect(navItems.length).toBe(11);
  });

  it('shows profile section inline by default (no ?section param)', () => {
    wrap(<SettingsLayout />);
    // Profile section is now rendered inline — look for its testid.
    expect(screen.getByTestId('profile-section')).toBeDefined();
  });

  it('shows tenant section inline when ?section=tenant', () => {
    // Set current tenant so useCurrentTenant() returns a value.
    const [tenantId] = Object.keys(useMockStore.getState().tenants);
    if (!tenantId) throw new Error('No tenants in store');
    useMockStore.setState({ currentTenantId: tenantId });
    mockSection = 'tenant';
    wrap(<SettingsLayout />);
    expect(screen.getByTestId('tenant-section')).toBeDefined();
  });

  it('shows notifications section with link to the notifications subpage', () => {
    mockSection = 'notifications';
    wrap(<SettingsLayout />);
    // Plan 7 switched notifications from an EmptyState to a live sub-route,
    // so the layout now renders an "Open notifications" anchor + plan label.
    expect(screen.getByTestId('settings-section-open-notifications')).toBeDefined();
    expect(screen.getByText(/plan 7/i)).toBeDefined();
  });

  it('shows network section inline when ?section=network', () => {
    // Set current tenant so useCurrentNetworkConfig() returns a value.
    const [tenantId] = Object.keys(useMockStore.getState().tenants);
    if (!tenantId) throw new Error('No tenants in store');
    useMockStore.setState({ currentTenantId: tenantId });
    mockSection = 'network';
    wrap(<SettingsLayout />);
    // NetworkSection is now rendered inline — check for its fieldsets.
    expect(screen.getByTestId('fieldset-listen-addresses')).toBeDefined();
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
