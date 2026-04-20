/**
 * Direct integration tests for settings/api.ts — avatar and tenant mutation paths.
 *
 * Tests mutation functions directly (bypassing Dropzone/UI stubs) to verify
 * store persistence, audit emission, and host event emission.
 *
 * Task 8a.2 — Profile section (avatar).
 * Task 8a.3 — Tenant section (name, url_mode, default_theme, logo).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { mockBus } from '@/api/mock-sse';
import { seedStore } from '@/api/mock-seed';
import { updateProfileAvatar, updateTenantName, updateTenantUrlMode, updateTenantDefaultTheme, updateTenantLogo } from '../api';

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
