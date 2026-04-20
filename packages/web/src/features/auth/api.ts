/**
 * Auth feature — mock auth operations backed by the Zustand mock store.
 *
 * Stage-1 semantics (spec §14.1 "UI present, backend deferred"):
 *  - Passwords are not checked — any non-empty string passes.
 *  - TOTP: any 6-digit numeric code passes.
 *  - All real cryptography happens in the daemon; these mocks satisfy the UI flow.
 *
 * spec §6 / Task 1e.83
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import type { User } from '@/api/resources/types';
import type {
  LoginResult,
  TotpResult,
  TotpEnrollment,
  BackupCodeResult,
  MockPasswordResetResult,
  BootstrapSetup,
  InviteSetup,
} from './types';

const nextUserId = makeIdFactory('bootstrap-user');
const nextTenantId = makeIdFactory('bootstrap-tenant');
const nextMembershipId = makeIdFactory('bootstrap-membership');

// ─── Audit helper ─────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

let _auditSeq = 0;

function auditId(): string {
  _auditSeq += 1;
  return `auth-audit-${String(_auditSeq).padStart(4, '0')}`;
}

// ─── login ────────────────────────────────────────────────────────────────────

/**
 * Attempt login with email + password.
 *
 * Stage-1: password is not validated — any non-empty string succeeds if the
 * email matches a user in the store.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  await simulateLatency('query');

  if (!password) {
    return { error: 'Password is required' };
  }

  const state = useMockStore.getState();
  const user = Object.values(state.users).find((u) => u.email === email);

  if (!user) {
    return { error: 'Invalid email or password' };
  }

  if (user.disabled) {
    return { error: 'Your account has been disabled. Contact your administrator.' };
  }

  if (user.totp_enrolled) {
    // Store the pending userId in mock-store for TOTP challenge step.
    useMockStore.setState({ pendingAuthUserId: user.id });
    return { requires_totp: true, pending_user_id: user.id };
  }

  // No TOTP — find primary tenant membership and resolve tenant slug.
  const membership = Object.values(state.memberships).find(
    (m) => m.user_id === user.id && m.state === 'active',
  );
  const tenantId = membership?.tenant_id ?? null;
  const tenant = tenantId ? state.tenants[tenantId] : null;
  const tenantSlug = tenant?.slug ?? null;

  useMockStore.setState({ currentUserId: user.id, currentTenantId: tenantId });

  state.appendAudit({
    id: auditId(),
    tenant_id: tenantId,
    actor_id: user.id,
    action: 'user.login',
    resource_type: 'user',
    resource_id: user.id,
    outcome: 'success',
    at: now(),
    tier: 'read-sensitive',
  });

  return { requires_totp: false, user_id: user.id, tenant_id: tenantSlug ?? '' };
}

// ─── logout ───────────────────────────────────────────────────────────────────

export async function logout(): Promise<void> {
  await simulateLatency('query');

  const state = useMockStore.getState();
  const userId = state.currentUserId;
  const tenantId = state.currentTenantId;

  if (userId) {
    state.appendAudit({
      id: auditId(),
      tenant_id: tenantId,
      actor_id: userId,
      action: 'user.logout',
      resource_type: 'user',
      resource_id: userId,
      outcome: 'success',
      at: now(),
      tier: 'read-sensitive',
    });
  }

  useMockStore.setState({
    currentUserId: null,
    currentTenantId: null,
    pendingAuthUserId: null,
  });
}

// ─── verifyTotp ───────────────────────────────────────────────────────────────

/**
 * Stage-1: any 6-digit numeric code accepts.
 * Real RFC 6238 validation is on the daemon (spec §14.1).
 */
export async function verifyTotp(code: string): Promise<TotpResult> {
  await simulateLatency('query');

  const isValid = /^\d{6}$/.test(code);
  if (!isValid) {
    return { ok: false, error: 'Code must be exactly 6 digits' };
  }

  const state = useMockStore.getState();
  const userId = state.pendingAuthUserId;

  if (!userId) {
    return { ok: false, error: 'No pending authentication session' };
  }

  const membership = Object.values(state.memberships).find(
    (m) => m.user_id === userId && m.state === 'active',
  );
  const tenantId = membership?.tenant_id ?? null;
  const tenant = tenantId ? state.tenants[tenantId] : null;
  const tenantSlug = tenant?.slug ?? null;

  useMockStore.setState({
    currentUserId: userId,
    currentTenantId: tenantId,
    pendingAuthUserId: null,
  });

  state.appendAudit({
    id: auditId(),
    tenant_id: tenantId,
    actor_id: userId,
    action: 'user.totp_verify',
    resource_type: 'user',
    resource_id: userId,
    outcome: 'success',
    at: now(),
    tier: 'read-sensitive',
  });

  return { ok: true, user_id: userId, tenant_id: tenantSlug ?? '' };
}

// ─── enrollTotp ───────────────────────────────────────────────────────────────

/**
 * Generate a mock TOTP enrollment payload.
 * Stores totp_secret + backup_codes on the User record.
 */
export async function enrollTotp(userId: string): Promise<TotpEnrollment> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const user = state.users[userId];
  if (!user) throw new Error('User not found');

  // Mock base32 secret — 16 chars (real = 20-byte random base32).
  const secret = 'JBSWY3DPEHPK3PXP';
  const issuer = 'Rioku';
  const label = encodeURIComponent(`${issuer}:${user.email}`);
  const qr_url = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

  // Generate 10 backup codes (10 chars, alphanumeric, uppercase).
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const backup_codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    let code = '';
    // Deterministic but varied per index — mock only, not cryptographic.
    for (let j = 0; j < 10; j++) {
      code += chars[(i * 37 + j * 13 + 7) % chars.length] ?? '';
    }
    backup_codes.push(code);
  }

  state.updateEntity('users', userId, {
    totp_secret: secret,
    backup_codes,
  });

  return { secret, qr_url, backup_codes };
}

// ─── confirmTotpEnrollment ────────────────────────────────────────────────────

/**
 * Confirm TOTP enrollment with a code from the authenticator.
 * Stage-1: any 6-digit code passes.
 */
export async function confirmTotpEnrollment(
  userId: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  await simulateLatency('mutation');

  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: 'Code must be exactly 6 digits' };
  }

  useMockStore.getState().updateEntity('users', userId, {
    totp_enrolled: true,
    totp_enabled: true,
  });

  return { ok: true };
}

// ─── verifyBackupCode ─────────────────────────────────────────────────────────

/**
 * Check a backup code, burn it on success, set session.
 */
export async function verifyBackupCode(code: string): Promise<BackupCodeResult> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const userId = state.pendingAuthUserId;

  if (!userId) {
    return { ok: false, error: 'No pending authentication session' };
  }

  const user = state.users[userId];
  if (!user) {
    return { ok: false, error: 'User not found' };
  }

  const codes = user.backup_codes ?? [];
  const normalised = code.trim().toUpperCase();
  const index = codes.indexOf(normalised);

  if (index === -1) {
    return { ok: false, error: 'Invalid backup code' };
  }

  // Burn the used code.
  const remaining = [...codes.slice(0, index), ...codes.slice(index + 1)];
  state.updateEntity('users', userId, { backup_codes: remaining });

  const membership = Object.values(state.memberships).find(
    (m) => m.user_id === userId && m.state === 'active',
  );
  const tenantId = membership?.tenant_id ?? null;
  const tenant = tenantId ? state.tenants[tenantId] : null;
  const tenantSlug = tenant?.slug ?? null;

  useMockStore.setState({
    currentUserId: userId,
    currentTenantId: tenantId,
    pendingAuthUserId: null,
  });

  state.appendAudit({
    id: auditId(),
    tenant_id: tenantId,
    actor_id: userId,
    action: 'user.backup_code_used',
    resource_type: 'user',
    resource_id: userId,
    outcome: 'success',
    at: now(),
    tier: 'destructive',
  });

  return { ok: true, user_id: userId, tenant_id: tenantSlug ?? '', remaining: remaining.length };
}

// ─── requestPasswordReset ─────────────────────────────────────────────────────

/**
 * Generate a mock password-reset link for display in the UI.
 * In real mode the daemon sends this link via email.
 */
export async function requestPasswordReset(
  email: string,
): Promise<MockPasswordResetResult | { error: string }> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const user = Object.values(state.users).find((u) => u.email === email);

  if (!user) {
    // Return success anyway to avoid email enumeration (spec §6).
    const token = `mock-reset-${String(Date.now())}`;
    return { mock_reset_link: `/reset-password/${token}` };
  }

  const token = `mock-reset-${String(Date.now())}-${user.id}`;
  return { mock_reset_link: `/reset-password/${token}` };
}

// ─── validateResetToken ───────────────────────────────────────────────────────

/**
 * Check if a reset token is valid and return minimal user info.
 * Stage-1: token is valid if it matches the mock-reset-<timestamp>-<userId> format
 * AND the userId exists. Force-reset tokens (force-reset-<userId>) are also accepted.
 */
export async function validateResetToken(
  token: string,
): Promise<{ ok: true; user_id: string; email: string } | { ok: false; error: string }> {
  await simulateLatency('query');

  const state = useMockStore.getState();

  // Force-reset token format: force-reset-<userId>
  if (token.startsWith('force-reset-')) {
    const userId = token.slice('force-reset-'.length);
    const user = state.users[userId];
    if (user) {
      return { ok: true, user_id: user.id, email: user.email };
    }
    return { ok: false, error: 'Invalid or expired password reset link' };
  }

  // Mock-reset token format: mock-reset-<timestamp>-<userId>
  // userId itself may contain hyphens (e.g. "user-0001"), so we scan all users.
  if (token.startsWith('mock-reset-')) {
    // Try to find a user whose id appears as a suffix in the token.
    const user = Object.values(state.users).find((u) => token.endsWith(`-${u.id}`));
    if (user) {
      return { ok: true, user_id: user.id, email: user.email };
    }
    return { ok: false, error: 'Invalid or expired password reset link' };
  }

  return { ok: false, error: 'Invalid or expired password reset link' };
}

// ─── generateForcePasswordToken ───────────────────────────────────────────────

/**
 * Generate a force-password-change token for the given user.
 * Returns a token that navigates to the reset-password flow.
 */
export function generateForcePasswordToken(userId: string): string {
  return `force-reset-${userId}`;
}

// ─── applyPasswordReset ───────────────────────────────────────────────────────

/**
 * Validate a reset token and update the user's password.
 * Stage-1: token is not validated — any token that contains a userId suffix passes.
 */
export async function applyPasswordReset(
  token: string,
  _newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();

  // Handle force-reset-<userId> format.
  if (token.startsWith('force-reset-')) {
    const userId = token.slice('force-reset-'.length);
    const user = state.users[userId];
    if (user) {
      state.updateEntity('users', user.id, { force_password_change: false });
    }
  } else if (token.startsWith('mock-reset-')) {
    // Mock-reset token format: mock-reset-<timestamp>-<userId> (userId may contain hyphens).
    const user = Object.values(state.users).find((u) => token.endsWith(`-${u.id}`));
    if (user) {
      state.updateEntity('users', user.id, { force_password_change: false });
    }
  }

  return { ok: true };
}

// ─── acceptInvite ─────────────────────────────────────────────────────────────

/**
 * Accept a pending membership invite.
 */
export async function acceptInvite(
  token: string,
  _setup: InviteSetup,
): Promise<{ ok: boolean; user_id?: string; tenant_id?: string; error?: string }> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const membership = Object.values(state.memberships).find(
    (m) => m.invite_token === token && m.state === 'pending',
  );

  if (!membership) {
    return { ok: false, error: 'Invalid or expired invite token' };
  }

  const expired =
    membership.invite_expires_at && new Date(membership.invite_expires_at) < new Date();
  if (expired) {
    return { ok: false, error: 'This invite has expired' };
  }

  state.updateEntity('memberships', membership.id, {
    state: 'active',
    joined_at: now(),
  });

  useMockStore.setState({
    currentUserId: membership.user_id,
    currentTenantId: membership.tenant_id,
  });

  return { ok: true, user_id: membership.user_id, tenant_id: membership.tenant_id };
}

// ─── bootstrap ───────────────────────────────────────────────────────────────

/**
 * Create the first root user + tenant. Only callable when no users exist.
 */
export async function bootstrap(
  setup: BootstrapSetup,
): Promise<{ ok: boolean; user_id?: string; tenant_id?: string; error?: string }> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  if (Object.keys(state.users).length > 0) {
    return { ok: false, error: 'Cannot bootstrap: users already exist' };
  }

  const tenantId = nextTenantId();
  const userId = nextUserId();
  const membershipId = nextMembershipId();

  const tenant = {
    id: tenantId,
    slug: setup.tenant_slug,
    name: setup.tenant_name,
    accent: '#22c55e',
    plan: 'community' as const,
    url_mode: 'path' as const,
    created_at: now(),
    updated_at: now(),
  };

  const user: User = {
    id: userId,
    email: setup.email,
    name: setup.name,
    disabled: false,
    totp_enabled: false,
    totp_enrolled: false,
    force_password_change: false,
    timezone: 'America/Los_Angeles',
    locale: 'en',
    reduced_motion: false,
    notification_preferences: { email: true, in_app: true, categories_muted: [] },
    created_at: now(),
    updated_at: now(),
  };

  const membership = {
    id: membershipId,
    tenant_id: tenantId,
    user_id: userId,
    role_ids: [] as string[],
    state: 'active' as const,
    invited_at: now(),
    joined_at: now(),
  };

  state.addEntity('tenants', tenant);
  state.addEntity('users', user);
  state.addEntity('memberships', membership);

  useMockStore.setState({ currentUserId: userId, currentTenantId: tenantId });

  return { ok: true, user_id: userId, tenant_id: tenantId };
}
