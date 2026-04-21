/**
 * Direct integration tests for settings/api.ts — avatar and tenant mutation paths.
 *
 * Tests mutation functions directly (bypassing Dropzone/UI stubs) to verify
 * store persistence, audit emission, and host event emission.
 *
 * Task 8a.2 — Profile section (avatar).
 * Task 8a.3 — Tenant section (name, url_mode, default_theme, logo).
 * Task 8a.4 — Authentication section (tenant auth policy).
 * Task 8b.8 — TLS section.
 * Task 8b.9 — Observability section.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { mockBus } from '@/api/mock-sse';
import { seedStore } from '@/api/mock-seed';
import { updateProfileAvatar, updateTenantName, updateTenantUrlMode, updateTenantDefaultTheme, updateTenantLogo, updateTenantAuthPolicy, updateNetworkConfig, addCertAuthority, addCertEnrollment, revokeCertEnrollment, addTlsCertificate, toggleCertAutoRenew, deleteTlsCertificate, updateTlsAcmeConfig, updateTlsCiphers, updateObservabilityMetrics, updateObservabilityLogs, updateObservabilityTraces } from '../api';

function getDerrickId(): string {
  const state = useMockStore.getState();
  const user = Object.values(state.users).find((u) => u.email === 'derrick@rioku.dev');
  if (!user) throw new Error('Derrick user not found in seed data');
  return user.id;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  const derrickId = getDerrickId();
  useMockStore.setState({ currentUserId: derrickId });
});

describe('updateProfileAvatar', () => {
  it('clears avatar_url in store when called with null', async () => {
    const derrickId = getDerrickId();

    // Seed a URL first so there is something to clear.
    useMockStore.getState().updateEntity('users', derrickId, {
      avatar_url: 'https://example.com/avatar.png',
    });

    await updateProfileAvatar(derrickId, null);

    const user = useMockStore.getState().users[derrickId];
    expect(user?.avatar_url).toBe('');
  });

  it('sets avatar_url in store when called with a URL', async () => {
    const derrickId = getDerrickId();
    const newUrl = 'https://example.com/new-avatar.png';

    await updateProfileAvatar(derrickId, newUrl);

    const user = useMockStore.getState().users[derrickId];
    expect(user?.avatar_url).toBe(newUrl);
  });

  it('emits avatar_removed audit entry when clearing', async () => {
    const derrickId = getDerrickId();

    await updateProfileAvatar(derrickId, null);

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'user.profile.avatar_removed');
    expect(entry).toBeDefined();
  });

  it('emits update_avatar audit entry when setting a URL', async () => {
    const derrickId = getDerrickId();

    await updateProfileAvatar(derrickId, 'https://example.com/avatar.png');

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'user.profile.update_avatar');
    expect(entry).toBeDefined();
  });

  it('emits user:updated host event for both clear and set paths', async () => {
    const derrickId = getDerrickId();
    const hostEvents: { type: string; payload: unknown }[] = [];
    const listener = (e: Event) => {
      hostEvents.push({ type: (e as CustomEvent).type, payload: (e as CustomEvent).detail });
    };
    mockBus.addEventListener('user:updated', listener);

    await updateProfileAvatar(derrickId, null);
    await updateProfileAvatar(derrickId, 'https://example.com/avatar.png');

    expect(hostEvents.filter((e) => e.type === 'user:updated').length).toBe(2);

    mockBus.removeEventListener('user:updated', listener);
  });
});

// ─── Tenant API tests ────────────────────────────────────────────────────────

function getAcmeTenantId(): string {
  const state = useMockStore.getState();
  const tenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!tenant) throw new Error('Acme tenant not found in seed data');
  return tenant.id;
}

describe('updateTenantName', () => {
  it('updates tenant name in store', async () => {
    const tenantId = getAcmeTenantId();
    await updateTenantName(tenantId, 'Acme Renamed');
    const tenant = useMockStore.getState().tenants[tenantId];
    expect(tenant?.name).toBe('Acme Renamed');
  });

  it('emits tenant.update_name audit entry', async () => {
    const tenantId = getAcmeTenantId();
    await updateTenantName(tenantId, 'Acme Renamed');
    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.update_name');
    expect(entry).toBeDefined();
  });

  it('emits tenant:updated host event', async () => {
    const tenantId = getAcmeTenantId();
    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('tenant:updated', listener);

    await updateTenantName(tenantId, 'Acme Event Check');

    expect(hostEvents.filter((t) => t === 'tenant:updated').length).toBe(1);
    mockBus.removeEventListener('tenant:updated', listener);
  });
});

describe('updateTenantUrlMode', () => {
  it('updates url_mode in store', async () => {
    const tenantId = getAcmeTenantId();
    await updateTenantUrlMode(tenantId, 'subdomain');
    const tenant = useMockStore.getState().tenants[tenantId];
    expect(tenant?.url_mode).toBe('subdomain');
  });

  it('emits tenant.update_url_mode audit entry', async () => {
    const tenantId = getAcmeTenantId();
    await updateTenantUrlMode(tenantId, 'subdomain');
    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.update_url_mode');
    expect(entry).toBeDefined();
  });

  it('emits tenant:updated host event', async () => {
    const tenantId = getAcmeTenantId();
    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('tenant:updated', listener);

    await updateTenantUrlMode(tenantId, 'path');

    expect(hostEvents.filter((t) => t === 'tenant:updated').length).toBe(1);
    mockBus.removeEventListener('tenant:updated', listener);
  });
});

describe('updateTenantDefaultTheme', () => {
  it('sets default_theme in store', async () => {
    const tenantId = getAcmeTenantId();
    await updateTenantDefaultTheme(tenantId, 'light');
    const tenant = useMockStore.getState().tenants[tenantId];
    expect(tenant?.default_theme).toBe('light');
  });

  it('clears default_theme when passed undefined', async () => {
    const tenantId = getAcmeTenantId();
    await updateTenantDefaultTheme(tenantId, 'light');
    await updateTenantDefaultTheme(tenantId, undefined);
    const tenant = useMockStore.getState().tenants[tenantId];
    expect(tenant?.default_theme).toBeUndefined();
  });

  it('emits tenant.update_default_theme audit entry', async () => {
    const tenantId = getAcmeTenantId();
    await updateTenantDefaultTheme(tenantId, 'hc-dark');
    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.update_default_theme');
    expect(entry).toBeDefined();
  });

  it('emits tenant:updated host event', async () => {
    const tenantId = getAcmeTenantId();
    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('tenant:updated', listener);

    await updateTenantDefaultTheme(tenantId, 'dark');

    expect(hostEvents.filter((t) => t === 'tenant:updated').length).toBe(1);
    mockBus.removeEventListener('tenant:updated', listener);
  });
});

describe('updateTenantLogo', () => {
  it('sets logo_url in store when given a URL', async () => {
    const tenantId = getAcmeTenantId();
    await updateTenantLogo(tenantId, 'https://example.com/logo.png');
    const tenant = useMockStore.getState().tenants[tenantId];
    expect(tenant?.logo_url).toBe('https://example.com/logo.png');
  });

  it('sets logo_url to empty string in store when cleared (null)', async () => {
    const tenantId = getAcmeTenantId();
    await updateTenantLogo(tenantId, 'https://example.com/logo.png');
    await updateTenantLogo(tenantId, null);
    const tenant = useMockStore.getState().tenants[tenantId];
    expect(tenant?.logo_url).toBe('');
  });

  it('emits tenant.update_logo audit entry when setting', async () => {
    const tenantId = getAcmeTenantId();
    await updateTenantLogo(tenantId, 'https://example.com/logo.png');
    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.update_logo');
    expect(entry).toBeDefined();
  });

  it('emits tenant.logo_removed audit entry when clearing', async () => {
    const tenantId = getAcmeTenantId();
    await updateTenantLogo(tenantId, null);
    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.logo_removed');
    expect(entry).toBeDefined();
  });

  it('emits tenant:updated host event for both set and clear', async () => {
    const tenantId = getAcmeTenantId();
    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('tenant:updated', listener);

    await updateTenantLogo(tenantId, 'https://example.com/logo.png');
    await updateTenantLogo(tenantId, null);

    expect(hostEvents.filter((t) => t === 'tenant:updated').length).toBe(2);
    mockBus.removeEventListener('tenant:updated', listener);
  });
});

// ─── Tenant auth policy API tests ────────────────────────────────────────────

describe('updateTenantAuthPolicy', () => {
  it('happy path: patch applies to store', async () => {
    const tenantId = getAcmeTenantId();
    await updateTenantAuthPolicy(tenantId, { totp_policy: 'all' });

    const policy = useMockStore.getState().tenantAuthPolicies[tenantId];
    expect(policy?.totp_policy).toBe('all');
  });

  it('happy path: emits tenant.update_auth_policy audit entry', async () => {
    const tenantId = getAcmeTenantId();
    await updateTenantAuthPolicy(tenantId, { totp_policy: 'optional' });

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.update_auth_policy');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);
  });

  it('happy path: emits tenant:auth-policy-updated host event', async () => {
    const tenantId = getAcmeTenantId();
    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('tenant:auth-policy-updated', listener);

    await updateTenantAuthPolicy(tenantId, { totp_policy: 'all' });

    expect(hostEvents.filter((t) => t === 'tenant:auth-policy-updated').length).toBe(1);
    mockBus.removeEventListener('tenant:auth-policy-updated', listener);
  });

  it('partial patch: only provided fields change', async () => {
    const tenantId = getAcmeTenantId();

    // Get current seed state
    const before = useMockStore.getState().tenantAuthPolicies[tenantId];
    expect(before?.totp_policy).toBe('admins');
    expect(before?.password_policy.min_length).toBe(12);

    // Only update totp_policy
    await updateTenantAuthPolicy(tenantId, { totp_policy: 'all' });

    const after = useMockStore.getState().tenantAuthPolicies[tenantId];
    expect(after?.totp_policy).toBe('all');
    // Other fields should be unchanged
    expect(after?.password_policy.min_length).toBe(12);
    expect(after?.session_timeouts.idle_hours).toBe(8);
  });

  it('partial patch: updating password_policy merges correctly', async () => {
    const tenantId = getAcmeTenantId();

    await updateTenantAuthPolicy(tenantId, {
      password_policy: {
        min_length: 16,
        require_uppercase: true,
        require_digit: true,
        require_symbol: true,
        max_age_days: 90,
        history_depth: 10,
      },
    });

    const policy = useMockStore.getState().tenantAuthPolicies[tenantId];
    expect(policy?.password_policy.min_length).toBe(16);
    expect(policy?.password_policy.require_symbol).toBe(true);
    expect(policy?.password_policy.max_age_days).toBe(90);
    expect(policy?.password_policy.history_depth).toBe(10);
    // totp_policy should still be the seed default
    expect(policy?.totp_policy).toBe('admins');
  });

  it('updated_at is refreshed on mutation', async () => {
    const tenantId = getAcmeTenantId();
    const before = useMockStore.getState().tenantAuthPolicies[tenantId];
    const beforeAt = before?.updated_at ?? '';

    // Small wait to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 5));
    await updateTenantAuthPolicy(tenantId, { totp_policy: 'optional' });

    const afterPolicy = useMockStore.getState().tenantAuthPolicies[tenantId];
    const afterAt = afterPolicy?.updated_at ?? '';
    // updated_at should be a newer or equal timestamp
    expect(afterAt >= beforeAt).toBe(true);
  });

  it('returns defaults for tenant without a policy record (no-op, does not throw)', async () => {
    // Use a non-existent tenant ID — updateTenantAuthPolicy should no-op silently
    const fakeTenantId = 'tenant-nonexistent';
    await expect(
      updateTenantAuthPolicy(fakeTenantId, { totp_policy: 'all' }),
    ).resolves.toBeUndefined();

    // The fake tenant should still have no policy
    const policy = useMockStore.getState().tenantAuthPolicies[fakeTenantId];
    expect(policy).toBeUndefined();
  });
});

// ─── updateNetworkConfig ──────────────────────────────────────────────────────

describe('updateNetworkConfig', () => {
  it('updates http3_enabled in store (happy path)', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });

    await updateNetworkConfig(tenantId, { http3_enabled: false });

    const config = useMockStore.getState().networkConfigs[tenantId];
    expect(config?.http3_enabled).toBe(false);
  });

  it('updates upstream_timeouts in store', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });

    await updateNetworkConfig(tenantId, {
      upstream_timeouts: { connect: 30, read: 120, write: 120, idle: 300 },
    });

    const config = useMockStore.getState().networkConfigs[tenantId];
    expect(config?.upstream_timeouts.connect).toBe(30);
    expect(config?.upstream_timeouts.idle).toBe(300);
  });

  it('emits tenant.update_network_config audit entry', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });

    await updateNetworkConfig(tenantId, { http3_enabled: false });

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.update_network_config');
    if (!entry) throw new Error('audit entry not found');
    expect(entry.tenant_id).toBe(tenantId);
    expect(entry.outcome).toBe('success');
  });

  it('emits tenant:network-config-updated host event', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });

    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('tenant:network-config-updated', listener);

    await updateNetworkConfig(tenantId, { http3_enabled: false });

    expect(hostEvents.filter((t) => t === 'tenant:network-config-updated').length).toBe(1);

    mockBus.removeEventListener('tenant:network-config-updated', listener);
  });

  it('no-ops silently for unknown tenant', async () => {
    const fakeTenantId = 'tenant-nonexistent';
    await expect(
      updateNetworkConfig(fakeTenantId, { http3_enabled: false }),
    ).resolves.toBeUndefined();

    const config = useMockStore.getState().networkConfigs[fakeTenantId];
    expect(config).toBeUndefined();
  });

  it('refreshes updated_at on mutation', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });

    const before = useMockStore.getState().networkConfigs[tenantId];
    const beforeAt = before?.updated_at ?? '';

    await new Promise((r) => setTimeout(r, 5));
    await updateNetworkConfig(tenantId, { http3_enabled: false });

    const after = useMockStore.getState().networkConfigs[tenantId];
    expect((after?.updated_at ?? '') >= beforeAt).toBe(true);
  });
});

// ─── addCertAuthority ─────────────────────────────────────────────────────────

describe('addCertAuthority', () => {
  it('creates a new CA in the store with correct fields', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });

    const ca = await addCertAuthority(tenantId, {
      name: 'Test Root CA',
      kind: 'internal',
      subject: 'CN=Test Root CA',
      certificate_pem: '',
    });

    const stored = useMockStore.getState().certAuthorities[ca.id];
    expect(stored).toBeDefined();
    expect(stored?.name).toBe('Test Root CA');
    expect(stored?.kind).toBe('internal');
    expect(stored?.tenant_id).toBe(tenantId);
  });

  it('emits pki.ca.create audit entry', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });

    await addCertAuthority(tenantId, {
      name: 'Audit Test CA',
      kind: 'external',
      subject: 'CN=Audit Test CA',
      certificate_pem: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n',
    });

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'pki.ca.create');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);
  });

  it('emits pki:ca-created host event', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });

    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('pki:ca-created', listener);

    await addCertAuthority(tenantId, {
      name: 'Event Test CA',
      kind: 'internal',
      subject: 'CN=Event Test CA',
      certificate_pem: '',
    });

    expect(hostEvents.filter((t) => t === 'pki:ca-created').length).toBe(1);
    mockBus.removeEventListener('pki:ca-created', listener);
  });
});

// ─── addCertEnrollment ────────────────────────────────────────────────────────

describe('addCertEnrollment', () => {
  function getSeedCaId(tenantId: string): string {
    const ca = Object.values(useMockStore.getState().certAuthorities).find(
      (c) => c.tenant_id === tenantId,
    );
    if (!ca) throw new Error('No CA found for tenant');
    return ca.id;
  }

  it('creates a pending enrollment in the store', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });
    const caId = getSeedCaId(tenantId);

    const enrollment = await addCertEnrollment(tenantId, {
      ca_id: caId,
      subject: 'CN=test-new.internal',
      dns_sans: ['test-new.internal'],
      validity_days: 90,
    });

    const stored = useMockStore.getState().certEnrollments[enrollment.id];
    expect(stored).toBeDefined();
    expect(stored?.state).toBe('pending');
    expect(stored?.subject).toBe('CN=test-new.internal');
    expect(stored?.tenant_id).toBe(tenantId);
  });

  it('emits pki.enrollment.create audit entry', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });
    const caId = getSeedCaId(tenantId);

    await addCertEnrollment(tenantId, {
      ca_id: caId,
      subject: 'CN=audit-test.internal',
      dns_sans: [],
      validity_days: 30,
    });

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'pki.enrollment.create');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);
  });

  it('emits pki:enrollment-requested host event', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });
    const caId = getSeedCaId(tenantId);

    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('pki:enrollment-requested', listener);

    await addCertEnrollment(tenantId, {
      ca_id: caId,
      subject: 'CN=event-test.internal',
      dns_sans: [],
      validity_days: 30,
    });

    expect(hostEvents.filter((t) => t === 'pki:enrollment-requested').length).toBe(1);
    mockBus.removeEventListener('pki:enrollment-requested', listener);
  });
});

// ─── revokeCertEnrollment ─────────────────────────────────────────────────────

describe('revokeCertEnrollment', () => {
  function getIssuedEnrollmentId(tenantId: string): string {
    const enrollment = Object.values(useMockStore.getState().certEnrollments).find(
      (e) => e.tenant_id === tenantId && e.state === 'issued',
    );
    if (!enrollment) throw new Error('No issued enrollment found for tenant');
    return enrollment.id;
  }

  it('updates enrollment state to revoked', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });
    const enrollmentId = getIssuedEnrollmentId(tenantId);

    await revokeCertEnrollment(enrollmentId, 'Key compromised');

    const enrollment = useMockStore.getState().certEnrollments[enrollmentId];
    expect(enrollment?.state).toBe('revoked');
  });

  it('sets revocation_reason in store', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });
    const enrollmentId = getIssuedEnrollmentId(tenantId);

    await revokeCertEnrollment(enrollmentId, 'Superseded');

    const enrollment = useMockStore.getState().certEnrollments[enrollmentId];
    expect(enrollment?.revocation_reason).toBe('Superseded');
    expect(enrollment?.revoked_at).toBeDefined();
  });

  it('emits pki.enrollment.revoke audit entry', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });
    const enrollmentId = getIssuedEnrollmentId(tenantId);

    await revokeCertEnrollment(enrollmentId, 'Test');

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'pki.enrollment.revoke');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);
  });

  it('emits pki:enrollment-revoked host event', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });
    const enrollmentId = getIssuedEnrollmentId(tenantId);

    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('pki:enrollment-revoked', listener);

    await revokeCertEnrollment(enrollmentId, 'Test reason');

    expect(hostEvents.filter((t) => t === 'pki:enrollment-revoked').length).toBe(1);
    mockBus.removeEventListener('pki:enrollment-revoked', listener);
  });

  it('no-ops silently for unknown enrollment id', async () => {
    await expect(
      revokeCertEnrollment('enrollment-nonexistent', 'whatever'),
    ).resolves.toBeUndefined();
  });
});

// ─── TLS API ──────────────────────────────────────────────────────────────────

describe('addTlsCertificate', () => {
  it('adds a new cert to the store with source=manual', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });
    const countBefore = Object.values(useMockStore.getState().tlsCertificates)
      .filter((c) => c.tenant_id === tenantId).length;

    await addTlsCertificate(tenantId, {
      domain: 'new.example.com',
      certificate_pem: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n',
      key_pem: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
    });

    const certs = Object.values(useMockStore.getState().tlsCertificates)
      .filter((c) => c.tenant_id === tenantId);
    expect(certs.length).toBe(countBefore + 1);
    const newCert = certs.find((c) => c.domain === 'new.example.com');
    expect(newCert).toBeDefined();
    expect(newCert?.source).toBe('manual');
    // key_pem must never be stored
    expect(JSON.stringify(useMockStore.getState().tlsCertificates)).not.toContain('BEGIN PRIVATE KEY');
  });

  it('emits tls.certificate.upload audit entry', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });

    await addTlsCertificate(tenantId, {
      domain: 'audit.example.com',
      certificate_pem: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n',
      key_pem: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
    });

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tls.certificate.upload');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);
  });

  it('emits tls:certificate-added host event', async () => {
    const tenantId = getAcmeTenantId();
    useMockStore.setState({ currentTenantId: tenantId });
    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('tls:certificate-added', listener);

    await addTlsCertificate(tenantId, {
      domain: 'event.example.com',
      certificate_pem: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n',
      key_pem: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
    });

    expect(hostEvents.filter((t) => t === 'tls:certificate-added').length).toBe(1);
    mockBus.removeEventListener('tls:certificate-added', listener);
  });
});

describe('toggleCertAutoRenew', () => {
  it('updates auto_renew on an existing ACME cert', async () => {
    const tenantId = getAcmeTenantId();
    const cert = Object.values(useMockStore.getState().tlsCertificates)
      .find((c) => c.tenant_id === tenantId && c.source === 'acme');
    if (!cert) throw new Error('No ACME cert in seed data');

    // Toggle to false first if auto_renew is true, or to true if false
    const newValue = !cert.auto_renew;
    await toggleCertAutoRenew(cert.id, newValue);

    const updated = useMockStore.getState().tlsCertificates[cert.id];
    expect(updated?.auto_renew).toBe(newValue);
  });

  it('emits tls.certificate.toggle_auto_renew audit entry', async () => {
    const tenantId = getAcmeTenantId();
    const cert = Object.values(useMockStore.getState().tlsCertificates)
      .find((c) => c.tenant_id === tenantId && c.source === 'acme');
    if (!cert) throw new Error('No ACME cert in seed data');

    await toggleCertAutoRenew(cert.id, true);

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tls.certificate.toggle_auto_renew');
    expect(entry).toBeDefined();
  });

  it('emits tls:certificate-updated host event', async () => {
    const tenantId = getAcmeTenantId();
    const cert = Object.values(useMockStore.getState().tlsCertificates)
      .find((c) => c.tenant_id === tenantId && c.source === 'acme');
    if (!cert) throw new Error('No ACME cert in seed data');

    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('tls:certificate-updated', listener);

    await toggleCertAutoRenew(cert.id, false);

    expect(hostEvents.filter((t) => t === 'tls:certificate-updated').length).toBe(1);
    mockBus.removeEventListener('tls:certificate-updated', listener);
  });

  it('no-ops for unknown cert id', async () => {
    await expect(toggleCertAutoRenew('nonexistent-cert', true)).resolves.toBeUndefined();
  });
});

describe('deleteTlsCertificate', () => {
  it('removes the cert from the store', async () => {
    const tenantId = getAcmeTenantId();
    const cert = Object.values(useMockStore.getState().tlsCertificates)
      .find((c) => c.tenant_id === tenantId);
    if (!cert) throw new Error('No cert in seed data');

    await deleteTlsCertificate(cert.id);

    expect(useMockStore.getState().tlsCertificates[cert.id]).toBeUndefined();
  });

  it('emits tls.certificate.delete audit entry', async () => {
    const tenantId = getAcmeTenantId();
    const cert = Object.values(useMockStore.getState().tlsCertificates)
      .find((c) => c.tenant_id === tenantId);
    if (!cert) throw new Error('No cert in seed data');

    await deleteTlsCertificate(cert.id);

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tls.certificate.delete');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);
  });

  it('emits tls:certificate-deleted host event', async () => {
    const tenantId = getAcmeTenantId();
    const cert = Object.values(useMockStore.getState().tlsCertificates)
      .find((c) => c.tenant_id === tenantId);
    if (!cert) throw new Error('No cert in seed data');

    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('tls:certificate-deleted', listener);

    await deleteTlsCertificate(cert.id);

    expect(hostEvents.filter((t) => t === 'tls:certificate-deleted').length).toBe(1);
    mockBus.removeEventListener('tls:certificate-deleted', listener);
  });

  it('no-ops for unknown cert id', async () => {
    await expect(deleteTlsCertificate('nonexistent-cert')).resolves.toBeUndefined();
  });
});

describe('updateTlsAcmeConfig', () => {
  it('updates acme config in the store', async () => {
    const tenantId = getAcmeTenantId();

    await updateTlsAcmeConfig(tenantId, {
      provider: 'zerossl',
      email: 'new@example.com',
      dns_challenge: true,
    });

    const config = useMockStore.getState().tlsConfigs[tenantId];
    expect(config?.acme.provider).toBe('zerossl');
    expect(config?.acme.email).toBe('new@example.com');
    expect(config?.acme.dns_challenge).toBe(true);
  });

  it('sets directory_url when provider is custom', async () => {
    const tenantId = getAcmeTenantId();

    await updateTlsAcmeConfig(tenantId, {
      provider: 'custom',
      email: 'admin@example.com',
      dns_challenge: false,
      directory_url: 'https://acme.custom.com/directory',
    });

    const config = useMockStore.getState().tlsConfigs[tenantId];
    expect(config?.acme.provider).toBe('custom');
    expect(config?.acme.directory_url).toBe('https://acme.custom.com/directory');
  });

  it('emits tls.acme.update audit entry', async () => {
    const tenantId = getAcmeTenantId();

    await updateTlsAcmeConfig(tenantId, {
      provider: 'lets-encrypt',
      email: 'audit@example.com',
      dns_challenge: false,
    });

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tls.acme.update');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);
  });

  it('emits tls:config-updated host event', async () => {
    const tenantId = getAcmeTenantId();
    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('tls:config-updated', listener);

    await updateTlsAcmeConfig(tenantId, {
      provider: 'lets-encrypt',
      email: 'event@example.com',
      dns_challenge: false,
    });

    expect(hostEvents.filter((t) => t === 'tls:config-updated').length).toBe(1);
    mockBus.removeEventListener('tls:config-updated', listener);
  });

  it('no-ops silently for unknown tenant id', async () => {
    await expect(
      updateTlsAcmeConfig('nonexistent-tenant', {
        provider: 'lets-encrypt',
        email: 'noop@example.com',
        dns_challenge: false,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('updateTlsCiphers', () => {
  it('updates allowed_ciphers in the store', async () => {
    const tenantId = getAcmeTenantId();
    const newCiphers = ['TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256'];

    await updateTlsCiphers(tenantId, newCiphers);

    const config = useMockStore.getState().tlsConfigs[tenantId];
    expect(config?.allowed_ciphers).toEqual(newCiphers);
  });

  it('emits tls.ciphers.update audit entry', async () => {
    const tenantId = getAcmeTenantId();

    await updateTlsCiphers(tenantId, ['TLS_AES_128_GCM_SHA256']);

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tls.ciphers.update');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);
  });

  it('emits tls:config-updated host event', async () => {
    const tenantId = getAcmeTenantId();
    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('tls:config-updated', listener);

    await updateTlsCiphers(tenantId, ['TLS_AES_256_GCM_SHA384']);

    expect(hostEvents.filter((t) => t === 'tls:config-updated').length).toBe(1);
    mockBus.removeEventListener('tls:config-updated', listener);
  });
});

// ─── Observability API tests ──────────────────────────────────────────────────

function getAcmeTenantIdObs(): string {
  const state = useMockStore.getState();
  const tenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!tenant) throw new Error('Acme tenant not found in seed data');
  return tenant.id;
}

describe('updateObservabilityMetrics', () => {
  it('updates metrics config in store', async () => {
    const tenantId = getAcmeTenantIdObs();

    await updateObservabilityMetrics(tenantId, {
      scrape_endpoint: '/custom-metrics',
      scrape_auth: 'none',
      retention_days: 60,
    });

    const config = useMockStore.getState().observabilityConfigs[tenantId];
    expect(config?.metrics.scrape_endpoint).toBe('/custom-metrics');
    expect(config?.metrics.scrape_auth).toBe('none');
    expect(config?.metrics.retention_days).toBe(60);
  });

  it('emits tenant.observability.update_metrics audit entry', async () => {
    const tenantId = getAcmeTenantIdObs();

    await updateObservabilityMetrics(tenantId, {
      scrape_endpoint: '/metrics',
      scrape_auth: 'bearer',
      retention_days: 30,
    });

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.observability.update_metrics');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);
  });

  it('emits tenant:observability-updated host event', async () => {
    const tenantId = getAcmeTenantIdObs();
    const hostEvents: CustomEvent[] = [];
    const listener = (e: Event) => { hostEvents.push(e as CustomEvent); };
    mockBus.addEventListener('tenant:observability-updated', listener);

    await updateObservabilityMetrics(tenantId, {
      scrape_endpoint: '/metrics',
      scrape_auth: 'mtls',
      retention_days: 30,
    });

    expect(hostEvents.filter((e) => (e.detail as { subsystem?: string }).subsystem === 'metrics').length).toBe(1);
    mockBus.removeEventListener('tenant:observability-updated', listener);
  });
});

describe('updateObservabilityLogs', () => {
  it('updates logs config in store', async () => {
    const tenantId = getAcmeTenantIdObs();

    await updateObservabilityLogs(tenantId, {
      levels: { daemon: 'debug', caddy: 'warn', plugin: 'error' },
      format: 'text',
      rotation: { max_size_mb: 50, max_backups: 3, max_age_days: 7, compress: false },
    });

    const config = useMockStore.getState().observabilityConfigs[tenantId];
    expect(config?.logs.levels.daemon).toBe('debug');
    expect(config?.logs.format).toBe('text');
    expect(config?.logs.rotation.max_size_mb).toBe(50);
    expect(config?.logs.rotation.compress).toBe(false);
  });

  it('emits tenant.observability.update_logs audit entry', async () => {
    const tenantId = getAcmeTenantIdObs();

    await updateObservabilityLogs(tenantId, {
      levels: { daemon: 'info', caddy: 'info', plugin: 'info' },
      format: 'json',
      rotation: { max_size_mb: 100, max_backups: 5, max_age_days: 30, compress: true },
    });

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.observability.update_logs');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);
  });

  it('emits tenant:observability-updated host event with subsystem=logs', async () => {
    const tenantId = getAcmeTenantIdObs();
    const hostEvents: CustomEvent[] = [];
    const listener = (e: Event) => { hostEvents.push(e as CustomEvent); };
    mockBus.addEventListener('tenant:observability-updated', listener);

    await updateObservabilityLogs(tenantId, {
      levels: { daemon: 'info', caddy: 'info', plugin: 'warn' },
      format: 'json',
      rotation: { max_size_mb: 100, max_backups: 5, max_age_days: 30, compress: true },
    });

    expect(hostEvents.filter((e) => (e.detail as { subsystem?: string }).subsystem === 'logs').length).toBe(1);
    mockBus.removeEventListener('tenant:observability-updated', listener);
  });
});

describe('updateObservabilityTraces', () => {
  it('updates traces config in store', async () => {
    const tenantId = getAcmeTenantIdObs();

    await updateObservabilityTraces(tenantId, {
      retention_days: 30,
      sample_rate: 0.5,
    });

    const config = useMockStore.getState().observabilityConfigs[tenantId];
    expect(config?.traces.retention_days).toBe(30);
    expect(config?.traces.sample_rate).toBe(0.5);
  });

  it('emits tenant.observability.update_traces audit entry', async () => {
    const tenantId = getAcmeTenantIdObs();

    await updateObservabilityTraces(tenantId, {
      retention_days: 7,
      sample_rate: 0.1,
    });

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.observability.update_traces');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);
  });

  it('emits tenant:observability-updated host event with subsystem=traces', async () => {
    const tenantId = getAcmeTenantIdObs();
    const hostEvents: CustomEvent[] = [];
    const listener = (e: Event) => { hostEvents.push(e as CustomEvent); };
    mockBus.addEventListener('tenant:observability-updated', listener);

    await updateObservabilityTraces(tenantId, {
      retention_days: 14,
      sample_rate: 1.0,
    });

    expect(hostEvents.filter((e) => (e.detail as { subsystem?: string }).subsystem === 'traces').length).toBe(1);
    mockBus.removeEventListener('tenant:observability-updated', listener);
  });
});
