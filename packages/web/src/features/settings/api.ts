/**
 * Settings feature — mock API for Profile and Tenant mutations.
 *
 * Backed by the Zustand mock store. Follows the conventions from
 * features/notification-channels/api.ts:
 *   - simulateLatency for realistic UX
 *   - appendAudit entry on every mutation
 *   - emitHostEvent on every mutation
 *   - atomic setState(s => ({...})) for multi-field patches
 *
 * Task 8a.2 — Profile section.
 * Task 8a.3 — Tenant section.
 * Task 8b.7 — PKI section.
 */
import { useMemo } from 'react';
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { AuditEntry, CertAuthority, CertEnrollment, ID, NetworkConfig, Tenant, TenantAuthPolicy, User } from '@/api/resources/types';
import type { CreateCaValues, CreateEnrollmentValues } from './schemas';

// ─── ID factory ───────────────────────────────────────────────────────────────

const nextAuditId = makeIdFactory('audit-profile');
const nextTenantAuditId = makeIdFactory('audit-tenant');
const nextAuthPolicyAuditId = makeIdFactory('audit-auth-policy');
const nextNetworkConfigAuditId = makeIdFactory('audit-network-config');
const nextPkiAuditId = makeIdFactory('audit-pki');
const nextCaId = makeIdFactory('ca');
const nextEnrollmentId = makeIdFactory('enrollment');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function currentActor(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function makeAudit(
  action: string,
  userId: ID,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  // Profile mutations are not tenant-scoped; use a synthetic tenant_id derived
  // from the user's first active membership (or 'unknown' if none).
  const state = useMockStore.getState();
  const membership = Object.values(state.memberships).find(
    (m) => m.user_id === userId && m.state === 'active',
  );
  const tenantId = membership?.tenant_id ?? state.currentTenantId ?? 'unknown';

  return {
    id: nextAuditId(),
    tenant_id: tenantId,
    actor_id: currentActor(),
    action,
    resource_type: 'user',
    resource_id: userId,
    outcome: 'success',
    at: now(),
    tier,
  };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/** Returns the current logged-in user from the store, or undefined. */
export function useCurrentUser(): User | undefined {
  return useMockStore((s) =>
    s.currentUserId ? s.users[s.currentUserId] : undefined,
  );
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Update the current user's display name. */
export async function updateProfileName(userId: ID, name: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  state.updateEntity('users', userId, { name, updated_at: now() });
  state.appendAudit(makeAudit('user.profile.update_name', userId));
  emitHostEvent('user:updated', { user_id: userId, fields: ['name'] });
}

/** Update the current user's avatar URL. Pass `null` to clear. */
export async function updateProfileAvatar(
  userId: ID,
  avatar_url: string | null,
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  // Always write avatar_url: use empty string as the cleared-state sentinel
  // so a page refresh sees no avatar rather than the stale previous value.
  const patch: Partial<User> = {
    avatar_url: avatar_url ?? '',
    updated_at: now(),
  };
  state.updateEntity('users', userId, patch);
  const auditAction =
    avatar_url == null ? 'user.profile.avatar_removed' : 'user.profile.update_avatar';
  state.appendAudit(makeAudit(auditAction, userId));
  emitHostEvent('user:updated', { user_id: userId, fields: ['avatar_url'] });
}

/**
 * Simulate a password change.
 * In mock mode we only validate that currentPassword is non-empty (no real
 * credential check) and mark force_password_change = false on success.
 * Returns `true` on success, `false` if the currentPassword is blank (mock
 * for "wrong password").
 */
export async function changePassword(
  userId: ID,
  currentPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  await simulateLatency('mutation');
  // Mock: reject if currentPassword === 'wrong' for testing, otherwise accept.
  if (!currentPassword) {
    return { ok: false, error: 'Current password is required.' };
  }
  const state = useMockStore.getState();
  state.updateEntity('users', userId, {
    force_password_change: false,
    updated_at: now(),
  });
  state.appendAudit(makeAudit('user.profile.change_password', userId, 'write'));
  emitHostEvent('user:password-changed', { user_id: userId });
  return { ok: true };
}

/**
 * Regenerate TOTP backup codes for the current user.
 * Generates 10 fresh mock codes (format: xxxxxx-xxxxxx).
 */
export async function resetBackupCodes(userId: ID): Promise<string[]> {
  await simulateLatency('mutation');
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const part = () =>
      Math.floor(Math.random() * 999999)
        .toString()
        .padStart(6, '0');
    codes.push(`${part()}-${part()}`);
  }
  const state = useMockStore.getState();
  state.updateEntity('users', userId, { backup_codes: codes, updated_at: now() });
  state.appendAudit(makeAudit('user.profile.reset_backup_codes', userId, 'write'));
  emitHostEvent('user:backup-codes-reset', { user_id: userId });
  return codes;
}

/** Update the current user's preferences (theme stored separately in localStorage). */
export async function updatePreferences(
  userId: ID,
  patch: {
    locale: string;
    timezone: string;
    reduced_motion: boolean;
    notification_email: boolean;
    notification_in_app: boolean;
    categories_muted: string[];
  },
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();

  state.updateEntity('users', userId, {
    locale: patch.locale,
    timezone: patch.timezone,
    reduced_motion: patch.reduced_motion,
    notification_preferences: {
      email: patch.notification_email,
      in_app: patch.notification_in_app,
      categories_muted: patch.categories_muted,
    },
    updated_at: now(),
  });
  state.appendAudit(makeAudit('user.profile.update_preferences', userId));
  emitHostEvent('user:updated', {
    user_id: userId,
    fields: ['locale', 'timezone', 'reduced_motion', 'notification_preferences'],
  });
}

// ─── Tenant selectors ─────────────────────────────────────────────────────────

/** Returns the current tenant from the store, or undefined. */
export function useCurrentTenant(): Tenant | undefined {
  return useMockStore((s) =>
    s.currentTenantId ? s.tenants[s.currentTenantId] : undefined,
  );
}

// ─── Tenant audit helper ──────────────────────────────────────────────────────

function makeTenantAudit(
  action: string,
  tenantId: ID,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  const state = useMockStore.getState();
  return {
    id: nextTenantAuditId(),
    tenant_id: tenantId,
    actor_id: state.currentUserId ?? 'unknown',
    action,
    resource_type: 'tenant',
    resource_id: tenantId,
    outcome: 'success',
    at: now(),
    tier,
  };
}

// ─── Tenant mutations ─────────────────────────────────────────────────────────

/** Update the tenant's display name. */
export async function updateTenantName(tenantId: ID, name: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  state.updateEntity('tenants', tenantId, { name, updated_at: now() });
  state.appendAudit(makeTenantAudit('tenant.update_name', tenantId));
  emitHostEvent('tenant:updated', { tenant_id: tenantId, fields: ['name'] });
}

/** Update the tenant's URL mode. */
export async function updateTenantUrlMode(
  tenantId: ID,
  mode: 'path' | 'subdomain',
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  state.updateEntity('tenants', tenantId, { url_mode: mode, updated_at: now() });
  state.appendAudit(makeTenantAudit('tenant.update_url_mode', tenantId));
  emitHostEvent('tenant:updated', { tenant_id: tenantId, fields: ['url_mode'] });
}

/** Update the tenant's default theme. Pass `undefined` to revert to system default. */
export async function updateTenantDefaultTheme(
  tenantId: ID,
  themeName: string | undefined,
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  if (themeName !== undefined) {
    // Set a specific theme.
    state.updateEntity('tenants', tenantId, { default_theme: themeName, updated_at: now() });
  } else {
    // Clear: delete the optional key by rebuilding the tenant object without it.
    useMockStore.setState((s) => {
      const t = s.tenants[tenantId];
      if (!t) return s;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { default_theme: _removed, ...rest } = t;
      return { tenants: { ...s.tenants, [tenantId]: { ...rest, updated_at: now() } } };
    });
  }
  state.appendAudit(makeTenantAudit('tenant.update_default_theme', tenantId));
  emitHostEvent('tenant:updated', { tenant_id: tenantId, fields: ['default_theme'] });
}

/** Update the tenant's logo URL. Pass `null` to clear (stored as ''). */
export async function updateTenantLogo(
  tenantId: ID,
  url: string | null,
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const patch: Partial<Tenant> = {
    logo_url: url ?? '',
    updated_at: now(),
  };
  state.updateEntity('tenants', tenantId, patch);
  const auditAction =
    url === null ? 'tenant.logo_removed' : 'tenant.update_logo';
  state.appendAudit(makeTenantAudit(auditAction, tenantId));
  emitHostEvent('tenant:updated', { tenant_id: tenantId, fields: ['logo_url'] });
}

// ─── Tenant auth policy selectors ─────────────────────────────────────────────

/** Returns the auth policy for the current tenant, or undefined if not found. */
export function useCurrentTenantAuthPolicy(): TenantAuthPolicy | undefined {
  return useMockStore((s) =>
    s.currentTenantId ? s.tenantAuthPolicies[s.currentTenantId] : undefined,
  );
}

// ─── Tenant auth policy audit helper ─────────────────────────────────────────

function makeAuthPolicyAudit(
  action: string,
  tenantId: ID,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  const state = useMockStore.getState();
  return {
    id: nextAuthPolicyAuditId(),
    tenant_id: tenantId,
    actor_id: state.currentUserId ?? 'unknown',
    action,
    resource_type: 'tenant',
    resource_id: tenantId,
    outcome: 'success',
    at: now(),
    tier,
  };
}

// ─── Tenant auth policy mutations ─────────────────────────────────────────────

/**
 * Atomically apply a partial patch to the tenant's auth policy and emit
 * audit + host events.
 */
export async function updateTenantAuthPolicy(
  tenantId: ID,
  patch: Partial<Omit<TenantAuthPolicy, 'tenant_id' | 'updated_at'>>,
): Promise<void> {
  await simulateLatency('mutation');
  useMockStore.setState((s) => {
    const current = s.tenantAuthPolicies[tenantId];
    if (!current) return s;
    return {
      tenantAuthPolicies: {
        ...s.tenantAuthPolicies,
        [tenantId]: { ...current, ...patch, updated_at: now() },
      },
    };
  });
  const state = useMockStore.getState();
  state.appendAudit(makeAuthPolicyAudit('tenant.update_auth_policy', tenantId));
  emitHostEvent('tenant:auth-policy-updated', { tenant_id: tenantId });
}

// ─── Network config selectors ─────────────────────────────────────────────────

/** Returns the network config for the current tenant, or undefined if not found. */
export function useCurrentNetworkConfig(): NetworkConfig | undefined {
  return useMockStore((s) =>
    s.currentTenantId ? s.networkConfigs[s.currentTenantId] : undefined,
  );
}

// ─── Network config audit helper ─────────────────────────────────────────────

function makeNetworkConfigAudit(
  action: string,
  tenantId: ID,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  const state = useMockStore.getState();
  return {
    id: nextNetworkConfigAuditId(),
    tenant_id: tenantId,
    actor_id: state.currentUserId ?? 'unknown',
    action,
    resource_type: 'tenant',
    resource_id: tenantId,
    outcome: 'success',
    at: now(),
    tier,
  };
}

// ─── Network config mutations ─────────────────────────────────────────────────

/**
 * Atomically apply a partial patch to the tenant's network config and emit
 * audit + host events.
 */
export async function updateNetworkConfig(
  tenantId: ID,
  patch: Partial<Omit<NetworkConfig, 'tenant_id' | 'updated_at'>>,
): Promise<void> {
  await simulateLatency('mutation');
  useMockStore.setState((s) => {
    const current = s.networkConfigs[tenantId];
    if (!current) return s;
    return {
      networkConfigs: {
        ...s.networkConfigs,
        [tenantId]: { ...current, ...patch, updated_at: now() },
      },
    };
  });
  const state = useMockStore.getState();
  state.appendAudit(makeNetworkConfigAudit('tenant.update_network_config', tenantId));
  emitHostEvent('tenant:network-config-updated', { tenant_id: tenantId });
}

// ─── PKI selectors ────────────────────────────────────────────────────────────

/**
 * Returns CAs for the current tenant as a sorted array.
 * Uses stable Zustand selector + useMemo per convention — no
 * filter/sort inside useMockStore(s => ...).
 */
export function useCertAuthorities(): CertAuthority[] {
  const allCas = useMockStore((s) => s.certAuthorities);
  const currentTenantId = useMockStore((s) => s.currentTenantId);
  return useMemo(
    () =>
      Object.values(allCas)
        .filter((ca) => ca.tenant_id === currentTenantId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [allCas, currentTenantId],
  );
}

/**
 * Returns cert enrollments for the current tenant as a sorted array.
 * Uses stable Zustand selector + useMemo per convention.
 */
export function useCertEnrollments(): CertEnrollment[] {
  const allEnrollments = useMockStore((s) => s.certEnrollments);
  const currentTenantId = useMockStore((s) => s.currentTenantId);
  return useMemo(
    () =>
      Object.values(allEnrollments)
        .filter((e) => e.tenant_id === currentTenantId)
        .sort((a, b) => b.requested_at.localeCompare(a.requested_at)),
    [allEnrollments, currentTenantId],
  );
}

// ─── PKI audit helper ─────────────────────────────────────────────────────────

function makePkiAudit(
  action: string,
  tenantId: ID,
  resourceId: ID,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  const state = useMockStore.getState();
  return {
    id: nextPkiAuditId(),
    tenant_id: tenantId,
    actor_id: state.currentUserId ?? 'unknown',
    action,
    resource_type: 'pki',
    resource_id: resourceId,
    outcome: 'success',
    at: now(),
    tier,
  };
}

// ─── PKI mutations ────────────────────────────────────────────────────────────

/** Create a new Certificate Authority and emit audit + host event. */
export async function addCertAuthority(
  tenantId: ID,
  values: CreateCaValues,
): Promise<CertAuthority> {
  await simulateLatency('mutation');
  const id = nextCaId();
  const ca: CertAuthority = {
    id,
    tenant_id: tenantId,
    name: values.name,
    kind: values.kind,
    subject: values.subject,
    // Mock: real implementation would parse issuer from certificate_pem for external CAs
    issuer: values.subject,
    not_before: now(),
    not_after: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString(),
    fingerprint_sha256: Array.from({ length: 64 }, (_, i) =>
      (((id.charCodeAt(i % id.length) + i * 7) % 16)).toString(16),
    ).join(''),
    certificate_pem: values.certificate_pem,
    created_at: now(),
  };
  const state = useMockStore.getState();
  state.addCertAuthority(ca);
  state.appendAudit(makePkiAudit('pki.ca.create', tenantId, id));
  emitHostEvent('pki:ca-created', { tenant_id: tenantId, ca_id: id });
  return ca;
}

/** Create a new certificate enrollment and emit audit + host event. */
export async function addCertEnrollment(
  tenantId: ID,
  values: CreateEnrollmentValues,
): Promise<CertEnrollment> {
  await simulateLatency('mutation');
  const id = nextEnrollmentId();
  const enrollment: CertEnrollment = {
    id,
    tenant_id: tenantId,
    ca_id: values.ca_id,
    subject: values.subject,
    dns_sans: values.dns_sans,
    state: 'pending',
    requested_at: now(),
  };
  const state = useMockStore.getState();
  state.addCertEnrollment(enrollment);
  state.appendAudit(makePkiAudit('pki.enrollment.create', tenantId, id));
  emitHostEvent('pki:enrollment-requested', { tenant_id: tenantId, enrollment_id: id });
  return enrollment;
}

/** Revoke a certificate enrollment and emit audit + host event. */
export async function revokeCertEnrollment(
  enrollmentId: ID,
  reason: string,
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const enrollment = state.certEnrollments[enrollmentId];
  if (!enrollment) return;

  state.updateCertEnrollment(enrollmentId, {
    state: 'revoked',
    revoked_at: now(),
    ...(reason.length > 0 ? { revocation_reason: reason } : {}),
  });
  const updatedState = useMockStore.getState();
  updatedState.appendAudit(makePkiAudit('pki.enrollment.revoke', enrollment.tenant_id, enrollmentId));
  emitHostEvent('pki:enrollment-revoked', { enrollment_id: enrollmentId, reason });
}
