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
 * Task 8b.8 — TLS section.
 * Task 8b.9 — Observability section.
 * Task 8c.11 — Integrations section (webhook endpoints).
 * Task 8c.13 — Danger zone (hard reset, export, delete tenant).
 * Task (notifications) — Tenant-scoped notification config.
 */
import { useMemo } from 'react';
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import { seedStore } from '@/api/mock-seed';
import { logAdminAuditEntry } from '@/api/resources/audit';
import type {
  AuditEntry,
  CertAuthority,
  CertEnrollment,
  ID,
  NetworkConfig,
  ObservabilityConfig,
  Tenant,
  TenantAuthPolicy,
  TenantNotificationConfig,
  TlsCertificate,
  TlsConfig,
  User,
  WebhookEndpoint,
} from '@/api/resources/types';
import type {
  CreateCaValues,
  CreateEnrollmentValues,
  MetricsConfigValues,
  LogsConfigValues,
  TracesConfigValues,
  TlsAcmeConfigValues,
  TlsCiphersValues,
  TlsUploadValues,
  TenantNotificationConfigValues,
  WebhookEndpointValues,
} from './schemas';

// ─── ID factory ───────────────────────────────────────────────────────────────

const nextAuditId = makeIdFactory('audit-profile');
const nextTenantAuditId = makeIdFactory('audit-tenant');
const nextAuthPolicyAuditId = makeIdFactory('audit-auth-policy');
const nextNetworkConfigAuditId = makeIdFactory('audit-network-config');
const nextPkiAuditId = makeIdFactory('audit-pki');
const nextTlsAuditId = makeIdFactory('audit-tls');
const nextObservabilityAuditId = makeIdFactory('audit-observability');
const nextIntegrationsAuditId = makeIdFactory('audit-integrations');
const nextCaId = makeIdFactory('ca');
const nextEnrollmentId = makeIdFactory('enrollment');
const nextTlsCertId = makeIdFactory('tlscert');
const nextWebhookId = makeIdFactory('webhook');
const nextDangerZoneAuditId = makeIdFactory('audit-danger-zone');
const nextNotificationConfigAuditId = makeIdFactory('audit-notification-config');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function currentActor(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function makeAudit(action: string, userId: ID, tier: AuditEntry['tier'] = 'write'): AuditEntry {
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
  return useMockStore((s) => (s.currentUserId ? s.users[s.currentUserId] : undefined));
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
export async function updateProfileAvatar(userId: ID, avatar_url: string | null): Promise<void> {
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
  return useMockStore((s) => (s.currentTenantId ? s.tenants[s.currentTenantId] : undefined));
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
export async function updateTenantUrlMode(tenantId: ID, mode: 'path' | 'subdomain'): Promise<void> {
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
export async function updateTenantLogo(tenantId: ID, url: string | null): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const patch: Partial<Tenant> = {
    logo_url: url ?? '',
    updated_at: now(),
  };
  state.updateEntity('tenants', tenantId, patch);
  const auditAction = url === null ? 'tenant.logo_removed' : 'tenant.update_logo';
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
  return useMockStore((s) => (s.currentTenantId ? s.networkConfigs[s.currentTenantId] : undefined));
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
      ((id.charCodeAt(i % id.length) + i * 7) % 16).toString(16),
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

/** Revoke a Certificate Authority. Marks the CA revoked and prevents new enrollments. */
export async function revokeCertAuthority(caId: ID, reason: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const ca = state.certAuthorities[caId];
  if (!ca) return;
  state.updateEntity('certAuthorities', caId, {
    revoked: true,
    revoked_at: now(),
    ...(reason.length > 0 ? { revocation_reason: reason } : {}),
  });
  state.appendAudit(makePkiAudit('pki.ca.revoke', ca.tenant_id, caId));
  emitHostEvent('pki:ca-revoked', { tenant_id: ca.tenant_id, ca_id: caId });
}

/** Permanently delete a Certificate Authority. Only allowed for already-revoked CAs. */
export async function deleteCertAuthority(caId: ID): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const ca = state.certAuthorities[caId];
  if (!ca) return;
  useMockStore.setState((s) => {
    const next = { ...s.certAuthorities };
    delete next[caId];
    return { certAuthorities: next };
  });
  state.appendAudit(makePkiAudit('pki.ca.delete', ca.tenant_id, caId));
  emitHostEvent('pki:ca-deleted', { tenant_id: ca.tenant_id, ca_id: caId });
}

/** Revoke a certificate enrollment and emit audit + host event. */
export async function revokeCertEnrollment(enrollmentId: ID, reason: string): Promise<void> {
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
  updatedState.appendAudit(
    makePkiAudit('pki.enrollment.revoke', enrollment.tenant_id, enrollmentId),
  );
  emitHostEvent('pki:enrollment-revoked', { enrollment_id: enrollmentId, reason });
}

// ─── TLS selectors ────────────────────────────────────────────────────────────

/**
 * Returns TLS certificates for the current tenant as a sorted array.
 * Uses stable Zustand selector + useMemo per convention.
 */
export function useTlsCertificates(): TlsCertificate[] {
  const allCerts = useMockStore((s) => s.tlsCertificates);
  const currentTenantId = useMockStore((s) => s.currentTenantId);
  return useMemo(
    () =>
      Object.values(allCerts)
        .filter((c) => c.tenant_id === currentTenantId)
        .sort((a, b) => a.domain.localeCompare(b.domain)),
    [allCerts, currentTenantId],
  );
}

/**
 * Returns the TLS config for the current tenant, or undefined if not found.
 */
export function useCurrentTlsConfig(): TlsConfig | undefined {
  return useMockStore((s) => (s.currentTenantId ? s.tlsConfigs[s.currentTenantId] : undefined));
}

// ─── TLS audit helper ─────────────────────────────────────────────────────────

function makeTlsAudit(
  action: string,
  tenantId: ID,
  resourceId: ID,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  const state = useMockStore.getState();
  return {
    id: nextTlsAuditId(),
    tenant_id: tenantId,
    actor_id: state.currentUserId ?? 'unknown',
    action,
    resource_type: 'tls',
    resource_id: resourceId,
    outcome: 'success',
    at: now(),
    tier,
  };
}

// ─── TLS mutations ────────────────────────────────────────────────────────────

/**
 * Add a new TLS certificate (manual upload) and emit audit + host event.
 * NOTE: key_pem is validated by schema but never stored here — private keys
 * must not be persisted in frontend state.
 */
export async function addTlsCertificate(
  tenantId: ID,
  values: TlsUploadValues,
): Promise<TlsCertificate> {
  await simulateLatency('mutation');
  // Destructure key_pem explicitly so it can never be accidentally spread into
  // the cert object. A future dev adding `...values` would immediately see the
  // unused variable and know the key must stay out of the store.
  const { domain, certificate_pem, key_pem: _keyPem } = values;
  void _keyPem; // key PEM is never persisted — private keys must not reach the store
  const id = nextTlsCertId();
  const cert: TlsCertificate = {
    id,
    tenant_id: tenantId,
    domain,
    issuer: 'Manual',
    source: 'manual',
    issued_at: now(),
    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    auto_renew: false,
    certificate_pem,
    // key_pem is never stored — private keys must not reach the store.
    fingerprint_sha256: Array.from({ length: 64 }, (_, i) =>
      ((id.charCodeAt(i % id.length) + i * 11) % 16).toString(16),
    ).join(''),
    created_at: now(),
  };
  const state = useMockStore.getState();
  state.addTlsCertificate(cert);
  state.appendAudit(makeTlsAudit('tls.certificate.upload', tenantId, id));
  emitHostEvent('tls:certificate-added', { tenant_id: tenantId, cert_id: id });
  return cert;
}

/** Toggle auto-renew on an ACME cert and emit audit + host event. */
export async function toggleCertAutoRenew(certId: ID, enabled: boolean): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const cert = state.tlsCertificates[certId];
  if (!cert) return;

  state.updateTlsCertificate(certId, { auto_renew: enabled });
  const updatedState = useMockStore.getState();
  updatedState.appendAudit(
    makeTlsAudit('tls.certificate.toggle_auto_renew', cert.tenant_id, certId),
  );
  emitHostEvent('tls:certificate-updated', { cert_id: certId, auto_renew: enabled });
}

/** Delete a TLS certificate and emit audit + host event. */
export async function deleteTlsCertificate(certId: ID): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const cert = state.tlsCertificates[certId];
  if (!cert) return;

  state.deleteTlsCertificate(certId);
  const updatedState = useMockStore.getState();
  updatedState.appendAudit(makeTlsAudit('tls.certificate.delete', cert.tenant_id, certId));
  emitHostEvent('tls:certificate-deleted', { cert_id: certId });
}

/** Update ACME config for a tenant and emit audit + host event. */
export async function updateTlsAcmeConfig(
  tenantId: ID,
  values: TlsAcmeConfigValues,
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const config = state.tlsConfigs[tenantId];
  if (!config) return;

  const acmePatch: TlsConfig['acme'] = {
    provider: values.provider,
    email: values.email,
    dns_challenge: values.dns_challenge,
    ...(values.directory_url != null ? { directory_url: values.directory_url } : {}),
  };
  state.updateTlsConfig(tenantId, { acme: acmePatch, updated_at: now() });
  const updatedState = useMockStore.getState();
  updatedState.appendAudit(makeTlsAudit('tls.acme.update', tenantId, tenantId));
  emitHostEvent('tls:config-updated', { tenant_id: tenantId });
}

/** Update allowed cipher suites for a tenant and emit audit + host event. */
export async function updateTlsCiphers(
  tenantId: ID,
  ciphers: TlsCiphersValues['allowed_ciphers'],
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  state.updateTlsConfig(tenantId, { allowed_ciphers: ciphers, updated_at: now() });
  const updatedState = useMockStore.getState();
  updatedState.appendAudit(makeTlsAudit('tls.ciphers.update', tenantId, tenantId));
  emitHostEvent('tls:config-updated', { tenant_id: tenantId });
}

// ─── Observability selectors ──────────────────────────────────────────────────

/**
 * Returns the observability config for the current tenant, or undefined if not found.
 * Uses stable Zustand selector.
 */
export function useCurrentObservabilityConfig(): ObservabilityConfig | undefined {
  return useMockStore((s) =>
    s.currentTenantId ? s.observabilityConfigs[s.currentTenantId] : undefined,
  );
}

// ─── Observability audit helper ───────────────────────────────────────────────

function makeObservabilityAudit(
  action: string,
  tenantId: ID,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  const state = useMockStore.getState();
  return {
    id: nextObservabilityAuditId(),
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

// ─── Observability mutations ──────────────────────────────────────────────────

/** Update metrics config for a tenant and emit audit + host event. */
export async function updateObservabilityMetrics(
  tenantId: ID,
  patch: MetricsConfigValues,
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  state.updateObservabilityConfig(tenantId, { metrics: patch });
  const updatedState = useMockStore.getState();
  updatedState.appendAudit(makeObservabilityAudit('tenant.observability.update_metrics', tenantId));
  emitHostEvent('tenant:observability-updated', { tenant_id: tenantId, subsystem: 'metrics' });
}

/** Update logs config for a tenant and emit audit + host event. */
export async function updateObservabilityLogs(
  tenantId: ID,
  patch: LogsConfigValues,
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  state.updateObservabilityConfig(tenantId, { logs: patch });
  const updatedState = useMockStore.getState();
  updatedState.appendAudit(makeObservabilityAudit('tenant.observability.update_logs', tenantId));
  emitHostEvent('tenant:observability-updated', { tenant_id: tenantId, subsystem: 'logs' });
}

/** Update traces config for a tenant and emit audit + host event. */
export async function updateObservabilityTraces(
  tenantId: ID,
  patch: TracesConfigValues,
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  state.updateObservabilityConfig(tenantId, { traces: patch });
  const updatedState = useMockStore.getState();
  updatedState.appendAudit(makeObservabilityAudit('tenant.observability.update_traces', tenantId));
  emitHostEvent('tenant:observability-updated', { tenant_id: tenantId, subsystem: 'traces' });
}

// ─── Integrations — Webhook endpoints ────────────────────────────────────────

/**
 * Returns all webhook endpoints for the current tenant, sorted by name.
 * Uses stable Zustand selector + useMemo per convention.
 */
export function useWebhookEndpoints(): WebhookEndpoint[] {
  const allEndpoints = useMockStore((s) => s.webhookEndpoints);
  const currentTenantId = useMockStore((s) => s.currentTenantId);
  return useMemo(
    () =>
      Object.values(allEndpoints)
        .filter((e) => e.tenant_id === currentTenantId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allEndpoints, currentTenantId],
  );
}

// ─── Integrations audit helper ────────────────────────────────────────────────

function makeIntegrationsAudit(
  action: string,
  tenantId: ID,
  resourceId: ID,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  const state = useMockStore.getState();
  return {
    id: nextIntegrationsAuditId(),
    tenant_id: tenantId,
    actor_id: state.currentUserId ?? 'unknown',
    action,
    resource_type: 'webhook_endpoint',
    resource_id: resourceId,
    outcome: 'success',
    at: now(),
    tier,
  };
}

/** Generate a random 32-char hex secret for a webhook endpoint. */
function generateWebhookSecret(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Create a new webhook endpoint and emit audit + host event. */
export async function addWebhookEndpoint(
  tenantId: ID,
  values: WebhookEndpointValues,
): Promise<void> {
  await simulateLatency('mutation');
  const id = nextWebhookId();
  const endpoint: WebhookEndpoint = {
    id,
    tenant_id: tenantId,
    name: values.name,
    path: values.path,
    expected_event_types: values.expected_event_types,
    secret: generateWebhookSecret(),
    enabled: values.enabled,
    created_at: now(),
  };
  const state = useMockStore.getState();
  state.addWebhookEndpoint(endpoint);
  const updatedState = useMockStore.getState();
  updatedState.appendAudit(makeIntegrationsAudit('tenant.webhook.create', tenantId, id));
  emitHostEvent('integrations:webhook-added', { tenant_id: tenantId, webhook_id: id });
}

/** Update an existing webhook endpoint and emit audit + host event. */
export async function updateWebhookEndpoint(
  id: ID,
  patch: Partial<WebhookEndpointValues>,
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const endpoint = state.webhookEndpoints[id];
  if (!endpoint) return;
  state.updateWebhookEndpoint(id, patch);
  const updatedState = useMockStore.getState();
  updatedState.appendAudit(makeIntegrationsAudit('tenant.webhook.update', endpoint.tenant_id, id));
  emitHostEvent('integrations:webhook-updated', { tenant_id: endpoint.tenant_id, webhook_id: id });
}

/** Delete a webhook endpoint and emit audit + host event. */
export async function deleteWebhookEndpoint(id: ID): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const endpoint = state.webhookEndpoints[id];
  if (!endpoint) return;
  state.deleteWebhookEndpoint(id);
  const updatedState = useMockStore.getState();
  updatedState.appendAudit(makeIntegrationsAudit('tenant.webhook.delete', endpoint.tenant_id, id));
  emitHostEvent('integrations:webhook-deleted', { tenant_id: endpoint.tenant_id, webhook_id: id });
}

// ─── Tenant notification config selectors ────────────────────────────────────

/** Returns the notification config for the current tenant, or undefined if not found. */
export function useCurrentNotificationConfig(): TenantNotificationConfig | undefined {
  return useMockStore((s) =>
    s.currentTenantId ? s.notificationConfigs[s.currentTenantId] : undefined,
  );
}

// ─── Tenant notification config counts (for summary cards) ───────────────────

/** Returns the count of active notification channels for the current tenant. */
export function useNotificationChannelCount(): number {
  const channels = useMockStore((s) => s.notificationChannels);
  const currentTenantId = useMockStore((s) => s.currentTenantId);
  return useMemo(
    () => Object.values(channels).filter((c) => c.tenant_id === currentTenantId).length,
    [channels, currentTenantId],
  );
}

/** Returns the count of routing rules for the current tenant. */
export function useNotificationRoutingRuleCount(): number {
  const rules = useMockStore((s) => s.notificationRoutingRules);
  const currentTenantId = useMockStore((s) => s.currentTenantId);
  return useMemo(
    () => Object.values(rules).filter((r) => r.tenant_id === currentTenantId).length,
    [rules, currentTenantId],
  );
}

/**
 * Returns count + delivered rate from the delivery log for the current tenant.
 * Scans all entries; designed for a small-to-medium Stage-1 mock store.
 */
export function useDeliveryLogSummary(): {
  total: number;
  delivered: number;
  successRate: number | null;
} {
  const log = useMockStore((s) => s.notificationDeliveryLog);
  const currentTenantId = useMockStore((s) => s.currentTenantId);
  return useMemo(() => {
    const entries = Object.values(log).filter((e) => e.tenant_id === currentTenantId);
    const total = entries.length;
    const delivered = entries.filter((e) => e.status === 'delivered').length;
    return {
      total,
      delivered,
      successRate: total > 0 ? Math.round((delivered / total) * 100) : null,
    };
  }, [log, currentTenantId]);
}

// ─── Tenant notification config audit helper ──────────────────────────────────

function makeNotificationConfigAudit(
  action: string,
  tenantId: ID,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  const state = useMockStore.getState();
  return {
    id: nextNotificationConfigAuditId(),
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

// ─── Tenant notification config mutations ─────────────────────────────────────

/**
 * Atomically apply a full values patch to the tenant's notification config
 * and emit audit + host event.
 */
export async function updateTenantNotificationConfig(
  tenantId: ID,
  values: TenantNotificationConfigValues,
): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  state.updateNotificationConfig(tenantId, {
    enabled: values.enabled,
    opt_in_mode: values.opt_in_mode,
    plugins_can_register_categories: values.plugins_can_register_categories,
    max_retries: values.max_retries,
    retry_backoff_seconds: values.retry_backoff_seconds,
  });
  const updatedState = useMockStore.getState();
  updatedState.appendAudit(
    makeNotificationConfigAudit('tenant.notification_config.update', tenantId),
  );
  emitHostEvent('tenant:notification-config-updated', { tenant_id: tenantId });
}

// ─── Danger zone ──────────────────────────────────────────────────────────────

function makeDangerZoneAudit(
  action: string,
  tenantId: ID,
  tier: AuditEntry['tier'] = 'destructive',
): AuditEntry {
  const state = useMockStore.getState();
  return {
    id: nextDangerZoneAuditId(),
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

/**
 * Hard-reset all tenant data for the given tenant back to seed defaults.
 *
 * STAGE-1 LIMITATION: this resets the entire mock store, not just the
 * specified tenant. Stage 2 will scope to the specific tenant_id.
 *
 * The UI shows a warning banner in the modal to communicate this limitation.
 * The host event is named `tenant:hard-reset-all-store` to make explicit that
 * subscribers will see a full-store wipe, not a scoped per-tenant reset.
 */
export async function hardResetTenant(tenantId: ID): Promise<void> {
  await simulateLatency('mutation');
  useMockStore.getState().reset();
  seedStore(useMockStore);
  const updatedState = useMockStore.getState();
  updatedState.appendAudit(makeDangerZoneAudit('tenant.hard_reset', tenantId));
  emitHostEvent('tenant:hard-reset-all-store', { tenant_id: tenantId });
}

/**
 * Trigger a browser download of the given Blob with the given filename.
 *
 * Exposed via `_internals` so tests can spy on it:
 *   `vi.spyOn(_internals, '_triggerBlobDownload').mockImplementation(...)`
 *
 * Internal calls go through `_internals._triggerBlobDownload(...)` so the spy
 * intercepts the call even in ESM where direct local-binding calls bypass the
 * module-namespace replacement.
 */
export function _triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Mutable internals object — lets tests spy on internal helpers even in ESM
 * where `vi.spyOn(module, 'fn')` cannot intercept same-module calls.
 */
export const _internals = { _triggerBlobDownload };

/**
 * Export all tenant-scoped data as a JSON blob and trigger a browser download.
 *
 * Collects all entity collections filtered to the given tenantId, bundles
 * them into a structured JSON object, and triggers a download of
 * `<slug>-export-<timestamp>.json`.
 */
export async function exportTenantJson(tenantId: ID): Promise<void> {
  await simulateLatency('query');
  const s = useMockStore.getState();
  const tenant = s.tenants[tenantId];
  if (!tenant) throw new Error('Tenant not found');

  const exportedAt = now();

  const payload = {
    tenant,
    services: Object.values(s.services).filter((x) => x.tenant_id === tenantId),
    // Routes are keyed by service_id (not tenant_id directly); include routes
    // whose service belongs to this tenant.
    routes: Object.values(s.routes).filter((r) => {
      const svc = s.services[r.service_id];
      return svc?.tenant_id === tenantId;
    }),
    users: Object.values(s.memberships)
      .filter((m) => m.tenant_id === tenantId)
      .map((m) => ({ ...s.users[m.user_id], membership: m }))
      .filter((u) => u.id != null),
    sites: Object.values(s.sites).filter((x) => x.tenant_id === tenantId),
    middlewares: Object.values(s.middlewares).filter((x) => x.tenant_id === tenantId),
    ai_agents: Object.values(s.aiAgents).filter((x) => x.tenant_id === tenantId),
    dashboards: Object.values(s.dashboards).filter((x) => x.tenant_id === tenantId),
    notifications: Object.values(s.notifications).filter((x) => x.tenant_id === tenantId),
    audit_entries: s.audit.filter((x) => x.tenant_id === tenantId),
    network_config: s.networkConfigs[tenantId] ?? null,
    tls_config: s.tlsConfigs[tenantId] ?? null,
    observability_config: s.observabilityConfigs[tenantId] ?? null,
    cert_authorities: Object.values(s.certAuthorities).filter((x) => x.tenant_id === tenantId),
    cert_enrollments: Object.values(s.certEnrollments).filter((x) => x.tenant_id === tenantId),
    webhook_endpoints: Object.values(s.webhookEndpoints).filter((x) => x.tenant_id === tenantId),
    tenant_auth_policy: s.tenantAuthPolicies[tenantId] ?? null,
    notification_config: s.notificationConfigs[tenantId] ?? null,
    exported_at: exportedAt,
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const timestamp = exportedAt.replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${tenant.slug}-export-${timestamp}.json`;

  // Trigger browser download. Uses _internals indirection so tests can spy
  // via vi.spyOn(_internals, '_triggerBlobDownload') in ESM environments.
  _internals._triggerBlobDownload(blob, filename);

  const updatedState = useMockStore.getState();
  updatedState.appendAudit(makeDangerZoneAudit('tenant.export', tenantId, 'write'));
  emitHostEvent('tenant:exported', { tenant_id: tenantId });
}

/**
 * Delete the tenant and cascade-delete all tenant-scoped records.
 *
 * Uses atomic setState to remove the tenant + all entities whose tenant_id
 * matches the given tenantId. Returns a promise so the caller can navigate
 * away after deletion.
 *
 * The tenant.delete audit entry is written to the super-admin cross-tenant
 * audit log (adminAudit) AFTER the cascade completes — this avoids the entry
 * being wiped when the tenant audit log is filtered. The host event is emitted
 * before the cascade so subscribers can react before state is torn down.
 */
export async function deleteTenant(tenantId: ID): Promise<void> {
  await simulateLatency('mutation');

  // Emit host event before deleting so consumers can react to the event.
  emitHostEvent('tenant:deleted', { tenant_id: tenantId });

  // Atomic cascade delete.
  useMockStore.setState((s) => {
    // Helper to filter a Record<ID, T> by tenant_id field.
    function filterOut<T extends { readonly tenant_id: ID }>(map: Record<ID, T>): Record<ID, T> {
      const next: Record<ID, T> = {};
      for (const [k, v] of Object.entries(map)) {
        if (v.tenant_id !== tenantId) next[k] = v;
      }
      return next;
    }

    // Memberships for this tenant — collect user IDs to check orphan cleanup.
    const membershipEntries = Object.values(s.memberships).filter((m) => m.tenant_id === tenantId);
    const membershipIds = new Set(membershipEntries.map((m) => m.id));

    const nextMemberships: Record<ID, (typeof s.memberships)[string]> = {};
    for (const [k, v] of Object.entries(s.memberships)) {
      if (!membershipIds.has(k)) nextMemberships[k] = v;
    }

    // Roles scoped to this tenant.
    const nextRoles: Record<ID, (typeof s.roles)[string]> = {};
    for (const [k, v] of Object.entries(s.roles)) {
      if (v.tenant_id !== tenantId) nextRoles[k] = v;
    }

    // Notifications: tenant_id can be null (cross-tenant broadcasts).
    const nextNotifications: Record<ID, (typeof s.notifications)[string]> = {};
    for (const [k, v] of Object.entries(s.notifications)) {
      if (v.tenant_id !== tenantId) nextNotifications[k] = v;
    }

    // Dashboards belonging to this tenant — collect IDs for widget orphan cleanup.
    const deletedDashboardIds = new Set(
      Object.values(s.dashboards)
        .filter((d) => d.tenant_id === tenantId)
        .map((d) => d.id),
    );

    // Widgets whose parent dashboard is being deleted (FK: dashboard_id).
    const nextWidgets: Record<ID, (typeof s.widgets)[string]> = {};
    for (const [k, v] of Object.entries(s.widgets)) {
      if (!deletedDashboardIds.has(v.dashboard_id)) nextWidgets[k] = v;
    }

    // DashboardVersions whose parent dashboard is being deleted (FK: dashboard_id).
    const nextDashboardVersions: Record<ID, (typeof s.dashboardVersions)[string]> = {};
    for (const [k, v] of Object.entries(s.dashboardVersions)) {
      if (!deletedDashboardIds.has(v.dashboard_id)) nextDashboardVersions[k] = v;
    }

    // Audit log: filter out all entries scoped to this tenant.
    // The tenant.delete entry is written to the cross-tenant adminAudit log
    // (after setState returns) so it is not lost here.
    const nextAudit = s.audit.filter((a) => a.tenant_id !== tenantId);

    // Per-tenant singleton records keyed by tenantId.
    const nextNetworkConfigs = { ...s.networkConfigs };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete nextNetworkConfigs[tenantId];
    const nextTenantAuthPolicies = { ...s.tenantAuthPolicies };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete nextTenantAuthPolicies[tenantId];
    const nextTlsConfigs = { ...s.tlsConfigs };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete nextTlsConfigs[tenantId];
    const nextObservabilityConfigs = { ...s.observabilityConfigs };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete nextObservabilityConfigs[tenantId];
    const nextNotificationConfigs = { ...s.notificationConfigs };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete nextNotificationConfigs[tenantId];
    const nextAuditRetentionConfigs = { ...s.auditRetentionConfigs };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete nextAuditRetentionConfigs[tenantId];

    // Remove the tenant itself.
    const nextTenants = { ...s.tenants };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete nextTenants[tenantId];

    // If the deleted tenant is the current tenant, clear the context.
    const nextCurrentTenantId = s.currentTenantId === tenantId ? null : s.currentTenantId;

    return {
      tenants: nextTenants,
      memberships: nextMemberships,
      roles: nextRoles,
      services: filterOut(s.services),
      // Routes are keyed by service_id, not tenant_id directly. Cascade-remove
      // routes whose parent service belongs to this tenant.
      routes: (() => {
        const nextRoutes: Record<ID, (typeof s.routes)[string]> = {};
        for (const [k, v] of Object.entries(s.routes)) {
          const svc = s.services[v.service_id];
          if (svc?.tenant_id !== tenantId) nextRoutes[k] = v;
        }
        return nextRoutes;
      })(),
      middlewares: filterOut(s.middlewares),
      sites: filterOut(s.sites),
      apiKeys: filterOut(s.apiKeys),
      sessions: filterOut(s.sessions),
      impersonationSessions: filterOut(s.impersonationSessions),
      accessPolicies: filterOut(s.accessPolicies),
      rbacPolicies: filterOut(s.rbacPolicies),
      certAuthorities: filterOut(s.certAuthorities),
      certEnrollments: filterOut(s.certEnrollments),
      tlsCertificates: filterOut(s.tlsCertificates),
      observabilityConfigs: nextObservabilityConfigs,
      webhookEndpoints: filterOut(s.webhookEndpoints),
      dashboards: filterOut(s.dashboards),
      widgets: nextWidgets,
      dashboardVersions: nextDashboardVersions,
      aiProviders: filterOut(s.aiProviders),
      aiAgents: filterOut(s.aiAgents),
      aiTools: filterOut(s.aiTools),
      aiTraces: filterOut(s.aiTraces),
      aiSemanticRateLimits: filterOut(s.aiSemanticRateLimits),
      aiToolBindings: filterOut(s.aiToolBindings),
      mcpServers: filterOut(s.mcpServers),
      notificationChannels: filterOut(s.notificationChannels),
      notificationRoutingRules: filterOut(s.notificationRoutingRules),
      notificationDeliveryLog: filterOut(s.notificationDeliveryLog),
      notifications: nextNotifications,
      notificationConfigs: nextNotificationConfigs,
      networkConfigs: nextNetworkConfigs,
      tenantAuthPolicies: nextTenantAuthPolicies,
      tlsConfigs: nextTlsConfigs,
      auditRetentionConfigs: nextAuditRetentionConfigs,
      audit: nextAudit,
      currentTenantId: nextCurrentTenantId,
    };
  });

  // Write the deletion audit entry to the super-admin cross-tenant log AFTER
  // the cascade so it cannot be wiped by the tenant audit filter above.
  const state = useMockStore.getState();
  await logAdminAuditEntry({
    tenant_id: tenantId,
    actor_id: state.currentUserId ?? 'unknown',
    action: 'tenant.delete',
    resource_type: 'tenant',
    resource_id: tenantId,
    outcome: 'success',
    tier: 'destructive',
  });
}
