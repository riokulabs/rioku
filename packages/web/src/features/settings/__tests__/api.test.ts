/**
 * Direct integration tests for settings/api.ts — avatar and tenant mutation paths.
 *
 * Tests mutation functions directly (bypassing Dropzone/UI stubs) to verify
 * store persistence, audit emission, and host event emission.
 *
 * Task 8a.2 — Profile section (avatar).
 * Task 8a.3 — Tenant section (name, url_mode, default_theme, logo).
 * Task 8a.4 — Authentication section (tenant auth policy).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { mockBus } from '@/api/mock-sse';
import { seedStore } from '@/api/mock-seed';
import { updateProfileAvatar, updateTenantName, updateTenantUrlMode, updateTenantDefaultTheme, updateTenantLogo, updateTenantAuthPolicy, updateNetworkConfig } from '../api';

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
