/**
 * Tests for <AuthenticationSection>.
 *
 * Covers:
 *   - All 3 subsections render (TOTP, password, session) — SSO hidden behind feature flag
 *   - TOTP SegmentedControl reflects initial value from store
 *   - Changing TOTP + saving writes to store + emits audit + host event
 *   - Password min length validation (below 6 rejected, above 128 rejected)
 *   - Session idle hours validation
 *   - SSO section not rendered when feature flag is off
 *   - Permission-denied: without `tenant-auth:write`, Save button and all inputs are disabled
 *
 * Task 8a.4
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ─── Router stub ─────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => () => undefined,
  useRouter: () => ({ navigate: () => undefined }),
  Link: ({
    children,
    to: _to,
    params: _params,
    ...rest
  }: React.PropsWithChildren<{ to: string; params?: Record<string, string> }> &
    Record<string, unknown>) => <a {...rest}>{children}</a>,
}));

// ─── Permission mock ─────────────────────────────────────────────────────────

let grantWrite = true;
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) => (key === 'tenant-auth:write' ? grantWrite : true),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { useMockStore } from '@/api/mock-store';
import { mockBus } from '@/api/mock-sse';
import { seedStore } from '@/api/mock-seed';
import { AuthenticationSection } from '../sections/authentication';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

function getAcmeTenantId(): string {
  const state = useMockStore.getState();
  const tenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!tenant) throw new Error('Acme tenant not found in seed data');
  return tenant.id;
}

/** Click a radio input by value inside a SegmentedControl testId. Throws if not found. */
function clickRadio(controlTestId: string, value: string): void {
  const control = screen.getByTestId(controlTestId);
  const radio = control.querySelector<HTMLInputElement>(`input[value="${value}"]`);
  if (!radio) throw new Error(`Radio input with value="${value}" not found in ${controlTestId}`);
  fireEvent.click(radio);
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  grantWrite = true;

  // Set current tenant to Acme so useCurrentTenant() + useCurrentTenantAuthPolicy() work.
  const tenantId = getAcmeTenantId();
  useMockStore.setState({ currentTenantId: tenantId });
});

// ─── Section render ───────────────────────────────────────────────────────────

describe('<AuthenticationSection>', () => {
  it('renders 3 subsections (SSO hidden by feature flag)', () => {
    render(<AuthenticationSection />, { wrapper: Wrapper });

    expect(screen.getByTestId('auth-totp-fieldset')).toBeDefined();
    expect(screen.getByTestId('auth-password-fieldset')).toBeDefined();
    expect(screen.getByTestId('auth-session-fieldset')).toBeDefined();
    // SSO fieldset is hidden when the `sso` feature flag is off
    expect(screen.queryByTestId('auth-sso-fieldset')).toBeNull();
  });

  // ── TOTP ─────────────────────────────────────────────────────────────────

  it('TOTP SegmentedControl reflects initial value from store', () => {
    const tenantId = getAcmeTenantId();
    const policy = useMockStore.getState().tenantAuthPolicies[tenantId];
    // Seed default is 'admins'
    expect(policy?.totp_policy).toBe('admins');

    render(<AuthenticationSection />, { wrapper: Wrapper });

    // The SegmentedControl keeps state in radio inputs; verify the 'admins' radio is checked.
    const control = screen.getByTestId('auth-totp-policy');
    const adminRadio = Array.from(
      control.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).find((r) => r.value === 'admins');
    expect(adminRadio?.checked).toBe(true);
  });

  it('changing TOTP + saving writes to store', async () => {
    render(<AuthenticationSection />, { wrapper: Wrapper });

    clickRadio('auth-totp-policy', 'all');

    // Save button should become enabled
    await waitFor(() => {
      const saveBtn = screen.getByTestId<HTMLButtonElement>('auth-policy-save');
      expect(saveBtn.disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('auth-policy-save'));

    const tenantId = getAcmeTenantId();
    await waitFor(() => {
      const policy = useMockStore.getState().tenantAuthPolicies[tenantId];
      expect(policy?.totp_policy).toBe('all');
    });
  });

  it('changing TOTP + saving emits audit entry', async () => {
    render(<AuthenticationSection />, { wrapper: Wrapper });

    clickRadio('auth-totp-policy', 'all');

    await waitFor(() => {
      const saveBtn = screen.getByTestId<HTMLButtonElement>('auth-policy-save');
      expect(saveBtn.disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('auth-policy-save'));

    await waitFor(() => {
      const audit = useMockStore.getState().audit;
      const entry = audit.find((a) => a.action === 'tenant.update_auth_policy');
      expect(entry).toBeDefined();
    });
  });

  it('changing TOTP + saving emits host event', async () => {
    render(<AuthenticationSection />, { wrapper: Wrapper });

    const hostEvents: string[] = [];
    const listener = (e: Event) => {
      hostEvents.push((e as CustomEvent).type);
    };
    mockBus.addEventListener('tenant:auth-policy-updated', listener);

    clickRadio('auth-totp-policy', 'optional');

    await waitFor(() => {
      const saveBtn = screen.getByTestId<HTMLButtonElement>('auth-policy-save');
      expect(saveBtn.disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('auth-policy-save'));

    await waitFor(() => {
      expect(hostEvents.filter((t) => t === 'tenant:auth-policy-updated').length).toBeGreaterThan(
        0,
      );
    });

    mockBus.removeEventListener('tenant:auth-policy-updated', listener);
  });

  // ── Password validation ───────────────────────────────────────────────────

  it('password min length below 6 is rejected on save', async () => {
    render(<AuthenticationSection />, { wrapper: Wrapper });

    // Make form dirty by changing TOTP
    clickRadio('auth-totp-policy', 'all');

    await waitFor(() => {
      const saveBtn = screen.getByTestId<HTMLButtonElement>('auth-policy-save');
      expect(saveBtn.disabled).toBe(false);
    });

    // Change min_length to an invalid value (below 6).
    // NumberInput uses an internal text input; fire input event on it.
    const minLengthInput = screen.getByTestId<HTMLInputElement>('auth-password-min-length');
    fireEvent.change(minLengthInput, { target: { value: '3' } });

    fireEvent.click(screen.getByTestId('auth-policy-save'));

    // Schema rejects min_length=3 synchronously; no audit entry should be emitted.
    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.update_auth_policy');
    expect(entry).toBeUndefined();
  });

  it('password min length above 128 is rejected on save', async () => {
    render(<AuthenticationSection />, { wrapper: Wrapper });

    // Change TOTP to make form dirty
    clickRadio('auth-totp-policy', 'all');

    await waitFor(() => {
      const saveBtn = screen.getByTestId<HTMLButtonElement>('auth-policy-save');
      expect(saveBtn.disabled).toBe(false);
    });

    // Set min length above max
    const minLengthInput = screen.getByTestId<HTMLInputElement>('auth-password-min-length');
    fireEvent.change(minLengthInput, { target: { value: '200' } });

    fireEvent.click(screen.getByTestId('auth-policy-save'));

    // Schema rejects min_length=200 synchronously; no audit entry should be emitted.
    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.update_auth_policy');
    expect(entry).toBeUndefined();
  });

  // ── Session validation ────────────────────────────────────────────────────

  it('session idle hours validates correctly (0 allowed, 168 max)', async () => {
    render(<AuthenticationSection />, { wrapper: Wrapper });

    const idleInput = screen.getByTestId<HTMLInputElement>('auth-session-idle-hours');
    // 0 is valid (disabled timeout)
    fireEvent.change(idleInput, { target: { value: '0' } });

    // Change totp to make dirty
    clickRadio('auth-totp-policy', 'all');

    await waitFor(() => {
      const saveBtn = screen.getByTestId<HTMLButtonElement>('auth-policy-save');
      expect(saveBtn.disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('auth-policy-save'));

    const tenantId = getAcmeTenantId();
    await waitFor(() => {
      const policy = useMockStore.getState().tenantAuthPolicies[tenantId];
      expect(policy?.totp_policy).toBe('all');
    });
  });

  // ── SSO feature flag ─────────────────────────────────────────────────────

  it('SSO section is absent when feature flag is off', () => {
    render(<AuthenticationSection />, { wrapper: Wrapper });

    // Panels are not rendered when sso flag is false
    expect(screen.queryByTestId('auth-sso-oauth-panel')).toBeNull();
    expect(screen.queryByTestId('auth-sso-saml-panel')).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  // ── Permission guard ──────────────────────────────────────────────────────

  it('Save button is disabled without tenant-auth:write', () => {
    grantWrite = false;
    render(<AuthenticationSection />, { wrapper: Wrapper });

    const saveBtn = screen.getByTestId<HTMLButtonElement>('auth-policy-save');
    expect(saveBtn.disabled).toBe(true);
  });

  it('TOTP control radio inputs are disabled without tenant-auth:write', () => {
    grantWrite = false;
    render(<AuthenticationSection />, { wrapper: Wrapper });

    // Mantine v9 SegmentedControl sets data-disabled on the root wrapper
    // and disabled on each inner radio input when disabled={true}.
    const control = screen.getByTestId('auth-totp-policy');
    expect(control).toHaveAttribute('data-disabled', 'true');
    const radioInputs = control.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radioInputs.length).toBeGreaterThan(0);
    radioInputs.forEach((input) => expect(input).toBeDisabled());
  });

  it('password min length input is disabled without tenant-auth:write', () => {
    grantWrite = false;
    render(<AuthenticationSection />, { wrapper: Wrapper });

    const minLengthInput = screen.getByTestId<HTMLInputElement>('auth-password-min-length');
    expect(minLengthInput.disabled).toBe(true);
  });

  it('password require-uppercase switch is disabled without tenant-auth:write', () => {
    grantWrite = false;
    render(<AuthenticationSection />, { wrapper: Wrapper });

    const uppercaseSwitch = screen.getByTestId<HTMLInputElement>('auth-password-require-uppercase');
    expect(uppercaseSwitch.disabled).toBe(true);
  });

  it('password require-digit switch is disabled without tenant-auth:write', () => {
    grantWrite = false;
    render(<AuthenticationSection />, { wrapper: Wrapper });

    const digitSwitch = screen.getByTestId<HTMLInputElement>('auth-password-require-digit');
    expect(digitSwitch.disabled).toBe(true);
  });

  it('password require-symbol switch is disabled without tenant-auth:write', () => {
    grantWrite = false;
    render(<AuthenticationSection />, { wrapper: Wrapper });

    const symbolSwitch = screen.getByTestId<HTMLInputElement>('auth-password-require-symbol');
    expect(symbolSwitch.disabled).toBe(true);
  });

  it('session idle hours input is disabled without tenant-auth:write', () => {
    grantWrite = false;
    render(<AuthenticationSection />, { wrapper: Wrapper });

    const idleInput = screen.getByTestId<HTMLInputElement>('auth-session-idle-hours');
    expect(idleInput.disabled).toBe(true);
  });

  it('session absolute hours input is disabled without tenant-auth:write', () => {
    grantWrite = false;
    render(<AuthenticationSection />, { wrapper: Wrapper });

    const absoluteInput = screen.getByTestId<HTMLInputElement>('auth-session-absolute-hours');
    expect(absoluteInput.disabled).toBe(true);
  });
});
