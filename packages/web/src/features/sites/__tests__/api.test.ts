/**
 * Tests for the sites API layer + wizard schema.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { createSite, updateSite, deleteSite, toggleSite, useSiteList } from '../api';
import { createSiteWizardSchema } from '../schemas';

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function tenantIdBySlug(slug: string): string {
  const state = useMockStore.getState();
  const tenant = Object.values(state.tenants).find((t) => t.slug === slug);
  if (!tenant) throw new Error(`No tenant with slug ${slug}`);
  return tenant.id;
}

function firstServiceForTenant(tenantId: string): string {
  const state = useMockStore.getState();
  const svc = Object.values(state.services).find((s) => s.tenant_id === tenantId);
  if (!svc) throw new Error('no service');
  return svc.id;
}

describe('createSiteWizardSchema', () => {
  const base = {
    name: 'my-site',
    domain: 'example.com',
    upstream_mode: 'existing_service' as const,
    upstream_service_id: 'svc-1',
    tls_mode: 'auto' as const,
  };

  it('accepts a valid existing-service payload', () => {
    expect(createSiteWizardSchema.safeParse(base).success).toBe(true);
  });

  it('rejects missing upstream_service_id when mode=existing_service', () => {
    const result = createSiteWizardSchema.safeParse({
      ...base,
      upstream_service_id: undefined,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'upstream_service_id')).toBe(true);
    }
  });

  it('rejects missing upstream_host/protocol when mode=new_upstream', () => {
    const result = createSiteWizardSchema.safeParse({
      ...base,
      upstream_mode: 'new_upstream',
      upstream_service_id: undefined,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'upstream_host')).toBe(true);
    }
  });

  it('rejects manual TLS without both PEMs', () => {
    const result = createSiteWizardSchema.safeParse({
      ...base,
      tls_mode: 'manual',
      tls_manual_cert_pem: undefined,
      tls_manual_key_pem: undefined,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'tls_manual_cert_pem')).toBe(true);
    }
  });

  it('rejects an invalid domain', () => {
    const result = createSiteWizardSchema.safeParse({ ...base, domain: 'not a domain' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid new_upstream payload with host+protocol', () => {
    const result = createSiteWizardSchema.safeParse({
      ...base,
      upstream_mode: 'new_upstream',
      upstream_service_id: undefined,
      upstream_protocol: 'http',
      upstream_host: 'api.internal',
      upstream_port: 8080,
    });
    expect(result.success).toBe(true);
  });
});

describe('createSite', () => {
  it('reuses the existing service when mode=existing_service', async () => {
    const tenantId = tenantIdBySlug('acme');
    const existingServiceId = firstServiceForTenant(tenantId);
    const servicesBefore = Object.keys(useMockStore.getState().services).length;

    const { site, service } = await createSite(tenantId, {
      name: 'reuse-site',
      domain: 'reuse.acme.com',
      upstream_mode: 'existing_service',
      upstream_service_id: existingServiceId,
      tls_mode: 'auto',
    });

    expect(service).toBeUndefined();
    expect(site.upstream_service_id).toBe(existingServiceId);
    expect(Object.keys(useMockStore.getState().services).length).toBe(servicesBefore);
  });

  it('creates a new service atomically when mode=new_upstream', async () => {
    const tenantId = tenantIdBySlug('acme');
    const servicesBefore = Object.keys(useMockStore.getState().services).length;

    const { site, service } = await createSite(tenantId, {
      name: 'new-upstream-site',
      domain: 'raw.acme.com',
      upstream_mode: 'new_upstream',
      upstream_protocol: 'http',
      upstream_host: 'raw.internal',
      upstream_port: 9000,
      tls_mode: 'auto',
    });

    if (!service) throw new Error('expected a created service');
    expect(site.upstream_service_id).toBe(service.id);
    expect(Object.keys(useMockStore.getState().services).length).toBe(servicesBefore + 1);
    expect(service.upstream).toBe('http://raw.internal:9000');

    // Both site.create and service.create audit entries should exist.
    const audit = useMockStore.getState().audit.slice(-2);
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('site.create');
    expect(actions).toContain('service.create');
  });

  it('stores manual-TLS cert previews but truncates PEM content', async () => {
    const tenantId = tenantIdBySlug('acme');
    const longCert = 'CERT' + 'A'.repeat(500);
    const longKey = 'KEY' + 'B'.repeat(500);

    const { site } = await createSite(tenantId, {
      name: 'tls-site',
      domain: 'tls.acme.com',
      upstream_mode: 'existing_service',
      upstream_service_id: firstServiceForTenant(tenantId),
      tls_mode: 'manual',
      tls_manual_cert_pem: longCert,
      tls_manual_key_pem: longKey,
    });
    expect(site.tls_manual_cert?.cert_pem_preview.length).toBeLessThanOrEqual(64);
    expect(site.tls_manual_cert?.key_pem_preview.length).toBeLessThanOrEqual(32);
  });
});

describe('updateSite / toggleSite', () => {
  it('updateSite applies patch and writes diff audit', async () => {
    const site = Object.values(useMockStore.getState().sites)[0];
    if (!site) throw new Error('no site');

    await updateSite(site.id, { name: 'renamed', basic_auth_enabled: true });

    const after = useMockStore.getState().sites[site.id];
    expect(after?.name).toBe('renamed');
    expect(after?.basic_auth_enabled).toBe(true);
    expect(useMockStore.getState().audit.at(-1)?.diff).toBeDefined();
  });

  it('toggleSite flips enabled + writes a dedicated audit action', async () => {
    const site = Object.values(useMockStore.getState().sites).find((s) => s.enabled);
    if (!site) throw new Error('no enabled site');

    await toggleSite(site.id, false);
    const after = useMockStore.getState().sites[site.id];
    expect(after?.enabled).toBe(false);
    expect(useMockStore.getState().audit.at(-1)?.action).toBe('site.disable');
  });
});

describe('deleteSite', () => {
  it('rejects when typed domain does not match', async () => {
    const site = Object.values(useMockStore.getState().sites)[0];
    if (!site) throw new Error('no site');
    await expect(deleteSite(site.id, 'wrong-domain.com')).rejects.toThrow(/does not match/);
    expect(useMockStore.getState().sites[site.id]).toBeDefined();
  });

  it('deletes and writes destructive audit when typed domain matches', async () => {
    const site = Object.values(useMockStore.getState().sites)[0];
    if (!site) throw new Error('no site');
    await deleteSite(site.id, site.domain);
    expect(useMockStore.getState().sites[site.id]).toBeUndefined();
    const latest = useMockStore.getState().audit.at(-1);
    expect(latest?.action).toBe('site.delete');
    expect(latest?.tier).toBe('destructive');
  });
});

describe('useSiteList', () => {
  it('filters by tenant', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() =>
      useSiteList(tenantId, {
        search: '',
        tls_mode: [],
        enabled: [],
        linked_service_ids: [],
      }),
    );
    expect(result.current.every((s) => s.tenant_id === tenantId)).toBe(true);
  });
});
