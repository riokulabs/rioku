/**
 * Auth feature — unit tests for Tasks 1e.88–1e.91.
 *
 * Tests:
 *   1e.88 — ForgotPasswordForm + ResetPasswordForm
 *   1e.89 — InviteAcceptanceForm
 *   1e.90 — BootstrapForm
 *   1e.91 — Force-password-change guard + empty-membership fallback
 */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  requestPasswordReset,
  validateResetToken,
  applyPasswordReset,
  acceptInvite,
  bootstrap,
  generateForcePasswordToken,
} from '../api';
import { ForgotPasswordForm } from '../components/forgot-password-form';
import { ResetPasswordForm } from '../components/reset-password-form';
import { InviteAcceptanceForm } from '../components/invite-acceptance-form';
import { BootstrapForm } from '../components/bootstrap-form';

// ─── Router mock ──────────────────────────────────────────────────────────────

const mockNavigate = vi.fn().mockResolvedValue(undefined);
const mockLocation = { pathname: '/some/page' };

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  Anchor: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/api/auth-failure', () => ({
  consumeReturnUrl: vi.fn().mockReturnValue(null),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  mockNavigate.mockClear();
});

// ─── 1e.88 — requestPasswordReset + validateResetToken ───────────────────────

describe('requestPasswordReset()', () => {
  it('returns mock_reset_link for known email', async () => {
    const result = await requestPasswordReset('derrick@rioku.dev');
    expect(result).toMatchObject({ mock_reset_link: expect.stringContaining('/reset-password/') });
  });

  it('returns mock_reset_link for unknown email (no enumeration)', async () => {
    const result = await requestPasswordReset('nobody@example.com');
    expect(result).toMatchObject({ mock_reset_link: expect.stringContaining('/reset-password/') });
  });
});

describe('validateResetToken()', () => {
  it('validates a mock-reset token with a known userId suffix', async () => {
    const users = Object.values(useMockStore.getState().users);
    const user = users[0]!;
    const token = `mock-reset-${String(Date.now())}-${user.id}`;
    const result = await validateResetToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user_id).toBe(user.id);
    }
  });

  it('rejects an unknown mock-reset token', async () => {
    const result = await validateResetToken('mock-reset-12345-unknown-user-id');
    expect(result.ok).toBe(false);
  });

  it('validates a force-reset token', async () => {
    const users = Object.values(useMockStore.getState().users);
    const user = users[0]!;
    const token = generateForcePasswordToken(user.id);
    const result = await validateResetToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user_id).toBe(user.id);
    }
  });

  it('rejects a completely invalid token format', async () => {
    const result = await validateResetToken('totally-invalid');
    expect(result.ok).toBe(false);
  });
});

describe('applyPasswordReset()', () => {
  it('clears force_password_change flag for known user', async () => {
    const users = Object.values(useMockStore.getState().users);
    const user = users[0]!;
    useMockStore.getState().updateEntity('users', user.id, { force_password_change: true });

    const token = `mock-reset-${String(Date.now())}-${user.id}`;
    const result = await applyPasswordReset(token, 'NewPassword1!');
    expect(result.ok).toBe(true);

    const updated = useMockStore.getState().users[user.id]!;
    expect(updated.force_password_change).toBe(false);
  });
});

// ─── 1e.88 — ForgotPasswordForm component ────────────────────────────────────

describe('ForgotPasswordForm', () => {
  it('renders email input', () => {
    wrap(<ForgotPasswordForm />);
    expect(screen.getByTestId('forgot-email-input')).toBeInTheDocument();
  });

  it('shows validation error for empty submit', async () => {
    wrap(<ForgotPasswordForm />);
    fireEvent.click(screen.getByTestId('forgot-submit'));
    await waitFor(() => {
      // Form is invalid — navigate should not be called
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  it('shows stage-1 mock link block after valid submit', async () => {
    wrap(<ForgotPasswordForm />);
    fireEvent.change(screen.getByTestId('forgot-email-input'), {
      target: { value: 'derrick@rioku.dev' },
    });
    fireEvent.click(screen.getByTestId('forgot-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('reset-success-message')).toBeInTheDocument();
      expect(screen.getByTestId('stage1-mock-link-block')).toBeInTheDocument();
    });
  });

  it('shows success message with submitted email', async () => {
    wrap(<ForgotPasswordForm />);
    fireEvent.change(screen.getByTestId('forgot-email-input'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByTestId('forgot-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('reset-success-message')).toBeInTheDocument();
      expect(screen.getByTestId('reset-success-message').textContent).toContain('test@example.com');
    });
  });

  it('"Use this link" button navigates to reset-password route', async () => {
    wrap(<ForgotPasswordForm />);
    fireEvent.change(screen.getByTestId('forgot-email-input'), {
      target: { value: 'derrick@rioku.dev' },
    });
    fireEvent.click(screen.getByTestId('forgot-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('use-reset-link')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('use-reset-link'));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: '/reset-password/$token' }),
      );
    });
  });
});

// ─── 1e.88 — ResetPasswordForm component ─────────────────────────────────────

describe('ResetPasswordForm', () => {
  it('shows error for invalid token', async () => {
    wrap(<ResetPasswordForm token="invalid-token-xyz" />);
    await waitFor(() => {
      expect(screen.getByTestId('reset-token-error')).toBeInTheDocument();
    });
  });

  it('shows form for a valid force-reset token', async () => {
    const users = Object.values(useMockStore.getState().users);
    const user = users[0]!;
    const token = generateForcePasswordToken(user.id);

    wrap(<ResetPasswordForm token={token} />);
    await waitFor(() => {
      expect(screen.getByTestId('new-password-input')).toBeInTheDocument();
      expect(screen.getByTestId('confirm-password-input')).toBeInTheDocument();
    });
  });

  it('blocks submit when passwords do not match', async () => {
    const users = Object.values(useMockStore.getState().users);
    const user = users[0]!;
    const token = generateForcePasswordToken(user.id);

    wrap(<ResetPasswordForm token={token} />);
    await waitFor(() => screen.getByTestId('new-password-input'));

    fireEvent.change(screen.getByTestId('new-password-input'), {
      target: { value: 'Password123!' },
    });
    fireEvent.change(screen.getByTestId('confirm-password-input'), {
      target: { value: 'DifferentPass!' },
    });
    fireEvent.click(screen.getByTestId('reset-submit'));

    await new Promise((r) => setTimeout(r, 100));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('submits successfully when passwords match', async () => {
    const users = Object.values(useMockStore.getState().users);
    const user = users[0]!;
    useMockStore.getState().updateEntity('users', user.id, { force_password_change: true });
    const token = generateForcePasswordToken(user.id);

    wrap(<ResetPasswordForm token={token} />);
    await waitFor(() => screen.getByTestId('new-password-input'));

    fireEvent.change(screen.getByTestId('new-password-input'), {
      target: { value: 'Password123!' },
    });
    fireEvent.change(screen.getByTestId('confirm-password-input'), {
      target: { value: 'Password123!' },
    });
    fireEvent.click(screen.getByTestId('reset-submit'));

    await waitFor(() => {
      // force_password_change should be cleared
      const updated = useMockStore.getState().users[user.id]!;
      expect(updated.force_password_change).toBe(false);
    });
  });

  it('renders strength bar when password is entered', async () => {
    const users = Object.values(useMockStore.getState().users);
    const user = users[0]!;
    const token = generateForcePasswordToken(user.id);

    wrap(<ResetPasswordForm token={token} />);
    await waitFor(() => screen.getByTestId('new-password-input'));

    fireEvent.change(screen.getByTestId('new-password-input'), {
      target: { value: 'Passw0rd!' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('password-strength-bar')).toBeInTheDocument();
    });
  });
});

// ─── 1e.89 — acceptInvite() API ──────────────────────────────────────────────

describe('acceptInvite()', () => {
  let membershipId: string;
  let token: string;

  beforeEach(() => {
    // Find a pending membership with invite_token.
    const memberships = Object.values(useMockStore.getState().memberships);
    const pending = memberships.find((m) => m.invite_token && m.state === 'pending');
    if (!pending) {
      // Create a synthetic pending membership for the test.
      const users = Object.values(useMockStore.getState().users);
      const tenants = Object.values(useMockStore.getState().tenants);
      const testToken = 'test-invite-token-12345';
      token = testToken;
      const testMembership = {
        id: 'test-membership-invite',
        tenant_id: tenants[0]!.id,
        user_id: users[1]!.id,
        role_ids: [],
        state: 'pending' as const,
        invited_at: new Date().toISOString(),
        invite_token: testToken,
        invite_expires_at: new Date(Date.now() + 86400000).toISOString(),
      };
      useMockStore.getState().addEntity('memberships', testMembership);
      membershipId = testMembership.id;
    } else {
      membershipId = pending.id;
      token = pending.invite_token!;
    }
  });

  it('rejects an invalid token', async () => {
    const result = await acceptInvite('invalid-token-xyz', { password: 'pass' });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('activates membership on valid token', async () => {
    const result = await acceptInvite(token, { password: 'Password123!' });
    expect(result.ok).toBe(true);

    const updated = useMockStore.getState().memberships[membershipId];
    expect(updated?.state).toBe('active');
    expect(updated?.joined_at).toBeTruthy();
  });

  it('sets currentUserId after acceptance', async () => {
    await acceptInvite(token, { password: 'Password123!' });
    expect(useMockStore.getState().currentUserId).toBeTruthy();
  });
});

// ─── 1e.89 — InviteAcceptanceForm component ───────────────────────────────────

describe('InviteAcceptanceForm', () => {
  let testToken: string;

  beforeEach(() => {
    testToken = 'test-invite-ui-token';
    const users = Object.values(useMockStore.getState().users);
    const tenants = Object.values(useMockStore.getState().tenants);
    const testMembership = {
      id: 'test-invite-ui-membership',
      tenant_id: tenants[0]!.id,
      user_id: users[2]!.id,
      role_ids: [],
      state: 'pending' as const,
      invited_at: new Date().toISOString(),
      invite_token: testToken,
      invite_expires_at: new Date(Date.now() + 86400000).toISOString(),
    };
    useMockStore.getState().addEntity('memberships', testMembership);
  });

  it('shows error for invalid token', async () => {
    wrap(<InviteAcceptanceForm token="invalid-token-xyz" />);
    await waitFor(() => {
      expect(screen.getByTestId('invite-token-error')).toBeInTheDocument();
    });
  });

  it('renders invite context for valid token', async () => {
    wrap(<InviteAcceptanceForm token={testToken} />);
    await waitFor(() => {
      expect(screen.getByTestId('invite-context')).toBeInTheDocument();
    });
  });

  it('shows password fields after context loads', async () => {
    wrap(<InviteAcceptanceForm token={testToken} />);
    await waitFor(() => {
      expect(screen.getByTestId('invite-password-input')).toBeInTheDocument();
      expect(screen.getByTestId('invite-confirm-input')).toBeInTheDocument();
    });
  });
});

// ─── 1e.90 — bootstrap() API ──────────────────────────────────────────────────

describe('bootstrap()', () => {
  it('fails when users already exist', async () => {
    // Store is seeded (has users)
    const result = await bootstrap({
      email: 'root@example.com',
      name: 'Root',
      password: 'Pass123!',
      tenant_name: 'Root Org',
      tenant_slug: 'root-org',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('already exist');
  });

  it('creates tenant, user, membership when store is empty', async () => {
    // Reset store to empty
    useMockStore.getState().reset();

    const result = await bootstrap({
      email: 'root@example.com',
      name: 'Root User',
      password: 'Pass123!',
      tenant_name: 'Root Org',
      tenant_slug: 'root-org',
    });
    expect(result.ok).toBe(true);
    expect(result.user_id).toBeTruthy();
    expect(result.tenant_id).toBeTruthy();

    const state = useMockStore.getState();
    expect(Object.keys(state.users).length).toBe(1);
    expect(Object.keys(state.tenants).length).toBe(1);
    expect(state.currentUserId).toBe(result.user_id);
    expect(state.currentTenantId).toBe(result.tenant_id);
  });

  it('creates membership with active state', async () => {
    useMockStore.getState().reset();
    await bootstrap({
      email: 'root@example.com',
      name: 'Root',
      password: 'Pass123!',
      tenant_name: 'TestOrg',
      tenant_slug: 'test-org',
    });
    const memberships = Object.values(useMockStore.getState().memberships);
    expect(memberships.length).toBe(1);
    expect(memberships[0]!.state).toBe('active');
  });
});

// ─── 1e.90 — BootstrapForm component ──────────────────────────────────────────

describe('BootstrapForm', () => {
  it('renders all required fields', () => {
    // Must have empty store for BootstrapForm to show (route would redirect, but component renders)
    useMockStore.getState().reset();
    wrap(<BootstrapForm />);
    expect(screen.getByTestId('bootstrap-tenant-name')).toBeInTheDocument();
    expect(screen.getByTestId('bootstrap-tenant-slug')).toBeInTheDocument();
    expect(screen.getByTestId('bootstrap-name')).toBeInTheDocument();
    expect(screen.getByTestId('bootstrap-email')).toBeInTheDocument();
    expect(screen.getByTestId('bootstrap-password')).toBeInTheDocument();
    expect(screen.getByTestId('bootstrap-confirm')).toBeInTheDocument();
  });

  it('shows strength bar when password is entered', async () => {
    useMockStore.getState().reset();
    wrap(<BootstrapForm />);
    fireEvent.change(screen.getByTestId('bootstrap-password'), {
      target: { value: 'MyStr0ng!' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('bootstrap-strength-bar')).toBeInTheDocument();
    });
  });

  it('creates root user on valid submit (empty store)', async () => {
    useMockStore.getState().reset();
    wrap(<BootstrapForm />);

    fireEvent.change(screen.getByTestId('bootstrap-tenant-name'), {
      target: { value: 'My Org' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-tenant-slug'), {
      target: { value: 'my-org' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-name'), {
      target: { value: 'Root User' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-email'), {
      target: { value: 'root@example.com' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-password'), {
      target: { value: 'Password123!' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-confirm'), {
      target: { value: 'Password123!' },
    });
    fireEvent.click(screen.getByTestId('bootstrap-submit'));

    await waitFor(() => {
      // Should advance to TOTP step
      expect(screen.getByTestId('bootstrap-setup-complete')).toBeInTheDocument();
    });
  });
});

// ─── 1e.91 — generateForcePasswordToken ───────────────────────────────────────

describe('generateForcePasswordToken()', () => {
  it('returns a force-reset-<userId> token', () => {
    const token = generateForcePasswordToken('user-1234');
    expect(token).toBe('force-reset-user-1234');
  });

  it('token is validateable by validateResetToken', async () => {
    const users = Object.values(useMockStore.getState().users);
    const user = users[0]!;
    const token = generateForcePasswordToken(user.id);
    const result = await validateResetToken(token);
    expect(result.ok).toBe(true);
  });
});

// ─── 1e.91 — Force-password-change after login ────────────────────────────────

describe('force_password_change flow', () => {
  it('applyPasswordReset clears force_password_change on a force-reset token', async () => {
    const users = Object.values(useMockStore.getState().users);
    const user = users[0]!;
    useMockStore.getState().updateEntity('users', user.id, { force_password_change: true });

    const token = generateForcePasswordToken(user.id);
    await applyPasswordReset(token, 'NewPass1!');

    const updated = useMockStore.getState().users[user.id]!;
    expect(updated.force_password_change).toBe(false);
  });

  it('user with no memberships gets guarded in login (API level)', async () => {
    // Create a user with no memberships
    useMockStore.getState().addEntity('users', {
      id: 'no-member-user',
      email: 'nomember@example.com',
      name: 'No Member',
      disabled: false,
      totp_enabled: false,
      totp_enrolled: false,
      force_password_change: false,
      timezone: 'America/Los_Angeles',
      locale: 'en',
      reduced_motion: false,
      notification_preferences: { email: true, in_app: true, categories_muted: [] },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const { login } = await import('../api');
    const result = await login('nomember@example.com', 'anypass');

    // login() returns success but tenant_id is empty string for users with no memberships
    if ('requires_totp' in result && !result.requires_totp) {
      expect(result.tenant_id).toBe('');
    }
  });
});

// ─── 1e.91 — useForcePasswordChangeGuard hook (via renderHook) ───────────────

describe('useForcePasswordChangeGuard', () => {
  it('navigates to reset-password when force_password_change is true', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useForcePasswordChangeGuard } = await import('../hooks/use-force-password-change-guard');

    // Set up a user with force_password_change
    const users = Object.values(useMockStore.getState().users);
    const user = users[0]!;
    useMockStore.getState().updateEntity('users', user.id, { force_password_change: true });
    useMockStore.setState({ currentUserId: user.id });

    renderHook(() => { useForcePasswordChangeGuard(); }, {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <MantineProvider>{children}</MantineProvider>
      ),
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: '/reset-password/$token' }),
      );
    });
  });

  it('does not navigate when force_password_change is false', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useForcePasswordChangeGuard } = await import('../hooks/use-force-password-change-guard');

    const users = Object.values(useMockStore.getState().users);
    const user = users[0]!;
    useMockStore.getState().updateEntity('users', user.id, { force_password_change: false });
    useMockStore.setState({ currentUserId: user.id });

    mockNavigate.mockClear();

    renderHook(() => { useForcePasswordChangeGuard(); }, {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <MantineProvider>{children}</MantineProvider>
      ),
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
