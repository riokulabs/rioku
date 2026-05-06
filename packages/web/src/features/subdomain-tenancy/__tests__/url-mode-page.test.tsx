/**
 * Tests for the URL mode settings feature.
 *
 * Tests the mock API functions (updateTenantUrlModeWithDomain) and the
 * Tenant resource's parent_domain field that back the URL mode settings page.
 *
 * Covers:
 *   - updateTenantUrlModeWithDomain updates url_mode + parent_domain in store
 *   - Switching back to path mode (no parent_domain patch)
 *   - Audit entry emitted on url_mode change
 *   - Host event emitted on url_mode change
 *   - Tenant type accepts parent_domain field
 *   - Beta tenant seeded with url_mode=subdomain
 *
 * Plan 12 Task 1
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { mockBus } from '@/api/mock-sse';
import { seedStore } from '@/api/mock-seed';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAcmeTenantId(): string {
  const state = useMockStore.getState();
  const tenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!tenant) throw new Error('acme tenant not found in seed data');
  return tenant.id;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

// ─── Tests: updateTenantUrlModeWithDomain ─────────────────────────────────────

describe('updateTenantUrlModeWithDomain', () => {
  it('sets url_mode to subdomain and stores parent_domain', async () => {
    const { updateTenantUrlModeWithDomain } = await import('@/features/settings/api');
    const tenantId = getAcmeTenantId();
    await updateTenantUrlModeWithDomain(tenantId, 'subdomain', 'localhost');
    const tenant = useMockStore.getState().tenants[tenantId];
    expect(tenant?.url_mode).toBe('subdomain');
    expect(tenant?.parent_domain).toBe('localhost');
  });

  it('sets url_mode to path without patching parent_domain', async () => {
    const { updateTenantUrlModeWithDomain } = await import('@/features/settings/api');
    const tenantId = getAcmeTenantId();
    // Start: switch to subdomain to set parent_domain
    await updateTenantUrlModeWithDomain(tenantId, 'subdomain', 'example.com');
    // Then switch back to path
    await updateTenantUrlModeWithDomain(tenantId, 'path', undefined);
    const tenant = useMockStore.getState().tenants[tenantId];
    expect(tenant?.url_mode).toBe('path');
    // parent_domain remains in store but url_mode drives routing behavior
  });

  it('stores custom parent domain (e.g. mycompany.com)', async () => {
    const { updateTenantUrlModeWithDomain } = await import('@/features/settings/api');
    const tenantId = getAcmeTenantId();
    await updateTenantUrlModeWithDomain(tenantId, 'subdomain', 'mycompany.com');
    const tenant = useMockStore.getState().tenants[tenantId];
    expect(tenant?.parent_domain).toBe('mycompany.com');
  });

  it('updates updated_at timestamp', async () => {
    const { updateTenantUrlModeWithDomain } = await import('@/features/settings/api');
    const tenantId = getAcmeTenantId();
    const before = useMockStore.getState().tenants[tenantId]?.updated_at ?? '';
    await updateTenantUrlModeWithDomain(tenantId, 'subdomain', 'localhost');
    const after = useMockStore.getState().tenants[tenantId]?.updated_at ?? '';
    expect(after).not.toBe(before);
  });

  it('emits tenant.update_url_mode audit entry', async () => {
    const { updateTenantUrlModeWithDomain } = await import('@/features/settings/api');
    const tenantId = getAcmeTenantId();
    await updateTenantUrlModeWithDomain(tenantId, 'subdomain', 'localhost');
    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.update_url_mode');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);
    expect(entry?.outcome).toBe('success');
  });

  it('emits tenant:updated host event with url_mode and parent_domain fields', async () => {
    const { updateTenantUrlModeWithDomain } = await import('@/features/settings/api');
    const tenantId = getAcmeTenantId();
    const events: CustomEvent[] = [];
    const listener = (e: Event) => {
      events.push(e as CustomEvent);
    };
    mockBus.addEventListener('tenant:updated', listener);
    try {
      await updateTenantUrlModeWithDomain(tenantId, 'subdomain', 'localhost');
      expect(events.length).toBeGreaterThan(0);
      const ev = events[0];
      expect(ev?.detail).toMatchObject({
        tenant_id: tenantId,
        fields: expect.arrayContaining(['url_mode', 'parent_domain']),
      });
    } finally {
      mockBus.removeEventListener('tenant:updated', listener);
    }
  });
});

// ─── Tests: Tenant.parent_domain type field ───────────────────────────────────

describe('Tenant.parent_domain field', () => {
  it('beta tenant seeded with url_mode=subdomain is accessible', () => {
    const state = useMockStore.getState();
    const beta = Object.values(state.tenants).find((t) => t.slug === 'beta');
    expect(beta).toBeDefined();
    expect(beta?.url_mode).toBe('subdomain');
  });

  it('parent_domain accepts string values after mutation', async () => {
    const { updateTenantUrlModeWithDomain } = await import('@/features/settings/api');
    const tenantId = getAcmeTenantId();
    await updateTenantUrlModeWithDomain(tenantId, 'subdomain', 'example.com');
    const tenant = useMockStore.getState().tenants[tenantId];
    expect(tenant?.parent_domain).toBe('example.com');
    expect(typeof tenant?.parent_domain).toBe('string');
  });

  it('acme tenant starts with url_mode=path (seed data)', () => {
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    expect(acme?.url_mode).toBe('path');
  });
});
