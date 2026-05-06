/**
 * Tests for settings sub-route page components (Plan 7).
 *
 * Each route file is a thin wrapper that renders the appropriate section
 * component with a "Back to settings" anchor. Tests verify:
 *   - The page wrapper renders with the correct data-testid
 *   - The "back to settings" anchor is present
 *   - The underlying section component renders (verified by checking
 *     a known testid from the section)
 *
 * These tests mount the page component directly without the TanStack Router
 * runtime — the route `useParams()` call is stubbed.
 *
 * Plan 7 — Tasks 1-9
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ─── Router stub ──────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useSearch: () => ({}),
    useNavigate: () => () => undefined,
    useRouter: () => ({ navigate: () => undefined }),
    useParams: () => ({ tenant: 'acme' }),
    Link: ({
      children,
      to: _to,
      params: _params,
      ...rest
    }: React.PropsWithChildren<{ to: string; params?: Record<string, string> }> &
      Record<string, unknown>) => <a {...rest}>{children}</a>,
  };
});

// ─── Permission mock ──────────────────────────────────────────────────────────

vi.mock('@/hooks/use-permission', () => ({
  usePermission: () => true,
}));

// ─── Theme stub ───────────────────────────────────────────────────────────────

vi.mock('@/hooks/use-active-theme', () => ({
  useActiveTheme: () => ['dark', vi.fn()] as [string, (v: string) => void],
}));

// ─── Feature flags mock ───────────────────────────────────────────────────────
// Turn off stage-2 gated flags so section components behave predictably.
vi.mock('@/host/feature-flags', () => ({
  isFeatureEnabled: (flag: string) =>
    flag !== 'passkeys' && flag !== 'sso' && flag !== 'integrationsOAuth',
}));

// ─── Monaco stub (NetworkSection uses it) ─────────────────────────────────────

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

// ─── Dropzone stub (ProfilePersonalInfo + TenantSection use it) ──────────────

function DropzoneStub({
  children,
  onDrop: _onDrop,
  ...rest
}: React.PropsWithChildren<Record<string, unknown>>) {
  return (
    <div data-testid="dropzone-stub" {...rest}>
      {children}
    </div>
  );
}
function Noop({ children }: React.PropsWithChildren) {
  return <>{children}</>;
}
DropzoneStub.Accept = Noop;
DropzoneStub.Reject = Noop;
DropzoneStub.Idle = Noop;

vi.mock('@mantine/dropzone', () => ({
  Dropzone: DropzoneStub,
  IMAGE_MIME_TYPE: ['image/png', 'image/jpeg'],
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';

// Import page components (not the route objects, just the page fn extracted
// by testing directly from the module's default export shape).
// Since route files use named inner functions, we import the full module
// and test the component rendered by the route.

// We test via a re-export approach: import the module and render the component
// that is the route's component. The route module exports `Route` but we can
// access `Route.options.component` for testing.

import * as ProfileRouteModule from '@/routes/t.$tenant/settings/profile';
import * as TenantRouteModule from '@/routes/t.$tenant/settings/tenant';
import * as AuthPolicyRouteModule from '@/routes/t.$tenant/settings/auth-policy';
import * as NetworkRouteModule from '@/routes/t.$tenant/settings/network';
import * as TlsRouteModule from '@/routes/t.$tenant/settings/tls';
import * as PkiRouteModule from '@/routes/t.$tenant/settings/pki';
import * as ObservabilityRouteModule from '@/routes/t.$tenant/settings/observability';
import * as IntegrationsRouteModule from '@/routes/t.$tenant/settings/integrations';
import * as DangerRouteModule from '@/routes/t.$tenant/settings/danger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

function getAcmeTenantId(): string {
  const state = useMockStore.getState();
  const tenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!tenant) throw new Error('acme tenant not found in store');
  return tenant.id;
}

// Extract the component from a route module
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteComponent(mod: { Route: any }): React.ComponentType {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return mod.Route.options.component as React.ComponentType;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  const tenantId = getAcmeTenantId();
  useMockStore.setState({ currentTenantId: tenantId });
});

// ─── Profile route ────────────────────────────────────────────────────────────

describe('settings/profile route', () => {
  it('renders the page wrapper with correct testid', () => {
    const PageComponent = getRouteComponent(ProfileRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-profile-page')).toBeDefined();
  });

  it('renders a back-to-settings link', () => {
    const PageComponent = getRouteComponent(ProfileRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-profile-back')).toBeDefined();
  });

  it('renders the ProfileSection inside', () => {
    const PageComponent = getRouteComponent(ProfileRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    // ProfileSection has a known testid for the personal-info subsection
    expect(screen.getByTestId('profile-personal-info')).toBeDefined();
  });
});

// ─── Tenant route ─────────────────────────────────────────────────────────────

describe('settings/tenant route', () => {
  it('renders the page wrapper with correct testid', () => {
    const PageComponent = getRouteComponent(TenantRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-tenant-page')).toBeDefined();
  });

  it('renders a back-to-settings link', () => {
    const PageComponent = getRouteComponent(TenantRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-tenant-back')).toBeDefined();
  });

  it('renders the TenantSection inside', () => {
    const PageComponent = getRouteComponent(TenantRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('tenant-section')).toBeDefined();
  });
});

// ─── Auth policy route ────────────────────────────────────────────────────────

describe('settings/auth-policy route', () => {
  it('renders the page wrapper with correct testid', () => {
    const PageComponent = getRouteComponent(AuthPolicyRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-auth-policy-page')).toBeDefined();
  });

  it('renders a back-to-settings link', () => {
    const PageComponent = getRouteComponent(AuthPolicyRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-auth-policy-back')).toBeDefined();
  });

  it('renders the AuthenticationSection inside', () => {
    const PageComponent = getRouteComponent(AuthPolicyRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('auth-totp-fieldset')).toBeDefined();
  });
});

// ─── Network route ────────────────────────────────────────────────────────────

describe('settings/network route', () => {
  it('renders the page wrapper with correct testid', () => {
    const PageComponent = getRouteComponent(NetworkRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-network-page')).toBeDefined();
  });

  it('renders a back-to-settings link', () => {
    const PageComponent = getRouteComponent(NetworkRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-network-back')).toBeDefined();
  });

  it('renders the NetworkSection inside', () => {
    const PageComponent = getRouteComponent(NetworkRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    // NetworkSection renders fieldset-listen-addresses as its first content block
    expect(screen.getByTestId('fieldset-listen-addresses')).toBeDefined();
  });
});

// ─── TLS route ───────────────────────────────────────────────────────────────

describe('settings/tls route', () => {
  it('renders the page wrapper with correct testid', () => {
    const PageComponent = getRouteComponent(TlsRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-tls-page')).toBeDefined();
  });

  it('renders a back-to-settings link', () => {
    const PageComponent = getRouteComponent(TlsRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-tls-back')).toBeDefined();
  });

  it('renders the TlsSection inside', () => {
    const PageComponent = getRouteComponent(TlsRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('tls-section')).toBeDefined();
  });
});

// ─── PKI route ───────────────────────────────────────────────────────────────

describe('settings/pki route', () => {
  it('renders the page wrapper with correct testid', () => {
    const PageComponent = getRouteComponent(PkiRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-pki-page')).toBeDefined();
  });

  it('renders a back-to-settings link', () => {
    const PageComponent = getRouteComponent(PkiRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-pki-back')).toBeDefined();
  });

  it('renders the PkiSection inside', () => {
    const PageComponent = getRouteComponent(PkiRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('pki-section')).toBeDefined();
  });
});

// ─── Observability route ──────────────────────────────────────────────────────

describe('settings/observability route', () => {
  it('renders the page wrapper with correct testid', () => {
    const PageComponent = getRouteComponent(ObservabilityRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-observability-page')).toBeDefined();
  });

  it('renders a back-to-settings link', () => {
    const PageComponent = getRouteComponent(ObservabilityRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-observability-back')).toBeDefined();
  });

  it('renders the ObservabilitySection inside', () => {
    const PageComponent = getRouteComponent(ObservabilityRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('observability-section')).toBeDefined();
  });
});

// ─── Integrations route ───────────────────────────────────────────────────────

describe('settings/integrations route', () => {
  it('renders the page wrapper with correct testid', () => {
    const PageComponent = getRouteComponent(IntegrationsRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-integrations-page')).toBeDefined();
  });

  it('renders a back-to-settings link', () => {
    const PageComponent = getRouteComponent(IntegrationsRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-integrations-back')).toBeDefined();
  });

  it('renders the IntegrationsSection inside', () => {
    const PageComponent = getRouteComponent(IntegrationsRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    // IntegrationsSection renders the webhook table section
    expect(screen.getByTestId('webhook-table-section')).toBeDefined();
  });
});

// ─── Danger route ─────────────────────────────────────────────────────────────

describe('settings/danger route', () => {
  it('renders the page wrapper with correct testid', () => {
    const PageComponent = getRouteComponent(DangerRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-danger-page')).toBeDefined();
  });

  it('renders a back-to-settings link', () => {
    const PageComponent = getRouteComponent(DangerRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('settings-danger-back')).toBeDefined();
  });

  it('renders the DangerZoneSection inside', () => {
    const PageComponent = getRouteComponent(DangerRouteModule);
    render(<PageComponent />, { wrapper: Wrapper });
    expect(screen.getByTestId('danger-zone-section')).toBeDefined();
  });
});
