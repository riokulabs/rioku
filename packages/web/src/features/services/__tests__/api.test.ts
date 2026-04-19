/**
 * Tests for the services API layer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  createService,
  updateService,
  deleteService,
  forceReloadService,
  useServiceList,
  useServiceDetail,
  useServiceRoutes,
} from '../api';
import { ServiceInUseError } from '../types';

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

describe('createService', () => {
  it('creates a service and appends a service.create audit entry', async () => {
    const tenantId = tenantIdBySlug('acme');
    const auditBefore = useMockStore.getState().audit.length;

    const service = await createService(tenantId, {
      name: 'new-api',
      upstream: 'http://new:9000',
      upstream_protocol: 'http',
      env: 'production',
      tags: ['tag-a'],
    });

    expect(service.name).toBe('new-api');
    expect(service.tenant_id).toBe(tenantId);
    expect(service.health).toBe('healthy');
    expect(service.tags).toEqual(['tag-a']);
    expect(useMockStore.getState().services[service.id]).toBeDefined();

    const audit = useMockStore.getState().audit;
    expect(audit.length).toBe(auditBefore + 1);
    expect(audit.at(-1)?.action).toBe('service.create');
  });
});

describe('updateService', () => {
  it('updates fields and records a diff in the audit entry', async () => {
    const state = useMockStore.getState();
    const existing = Object.values(state.services)[0];
    if (!existing) throw new Error('no service seeded');

    await updateService(existing.id, { name: 'renamed-api', tags: ['renamed'] });

    const after = useMockStore.getState().services[existing.id];
    expect(after?.name).toBe('renamed-api');
    expect(after?.tags).toEqual(['renamed']);

    const latest = useMockStore.getState().audit.at(-1);
    expect(latest?.action).toBe('service.update');
    expect(latest?.diff).toBeDefined();
  });
});

describe('deleteService', () => {
  it('throws ServiceInUseError when routes still reference the service', async () => {
    const state = useMockStore.getState();
    const serviceWithRoutes = Object.values(state.services).find((svc) =>
      Object.values(state.routes).some((r) => r.service_id === svc.id),
    );
    if (!serviceWithRoutes) throw new Error('no service with routes seeded');

    await expect(deleteService(serviceWithRoutes.id)).rejects.toBeInstanceOf(
      ServiceInUseError,
    );
    expect(useMockStore.getState().services[serviceWithRoutes.id]).toBeDefined();
  });

  it('deletes and writes a destructive-tier audit when no routes reference it', async () => {
    const tenantId = tenantIdBySlug('acme');
    const svc = await createService(tenantId, {
      name: 'delete-me',
      upstream: 'http://del:1',
      upstream_protocol: 'http',
      env: 'production',
    });

    await deleteService(svc.id);

    expect(useMockStore.getState().services[svc.id]).toBeUndefined();
    const latest = useMockStore.getState().audit.at(-1);
    expect(latest?.action).toBe('service.delete');
    expect(latest?.tier).toBe('destructive');
  });
});

describe('forceReloadService', () => {
  it('bumps last_reloaded_at and emits service.reload audit', async () => {
    const state = useMockStore.getState();
    const existing = Object.values(state.services)[0];
    if (!existing) throw new Error('no service');

    const previousReload = existing.last_reloaded_at;
    await forceReloadService(existing.id);

    const after = useMockStore.getState().services[existing.id];
    expect(after?.last_reloaded_at).toBeDefined();
    expect(after?.last_reloaded_at).not.toBe(previousReload);

    const latest = useMockStore.getState().audit.at(-1);
    expect(latest?.action).toBe('service.reload');
  });
});

describe('useServiceList', () => {
  it('returns services only for the given tenant', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() =>
      useServiceList(tenantId, { search: '', health: 'all', env: 'all', tag: null }),
    );
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.every((s) => s.tenant_id === tenantId)).toBe(true);
  });

  it('filters by search over name/description/upstream', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() =>
      useServiceList(tenantId, { search: 'auth', health: 'all', env: 'all', tag: null }),
    );
    expect(result.current.length).toBeGreaterThan(0);
    expect(
      result.current.every((s) => s.name.includes('auth') || s.description?.includes('auth')),
    ).toBe(true);
  });

  it('filters by tag when a tag filter is set', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() =>
      useServiceList(tenantId, { search: '', health: 'all', env: 'all', tag: 'auth' }),
    );
    expect(result.current.every((s) => s.tags.includes('auth'))).toBe(true);
  });
});

describe('useServiceDetail + useServiceRoutes', () => {
  it('useServiceDetail returns the service', () => {
    const existing = Object.values(useMockStore.getState().services)[0];
    if (!existing) throw new Error('no service');
    const { result } = renderHook(() => useServiceDetail(existing.id));
    expect(result.current?.id).toBe(existing.id);
  });

  it('useServiceRoutes returns only attached routes', () => {
    const existing = Object.values(useMockStore.getState().services)[0];
    if (!existing) throw new Error('no service');
    const { result } = renderHook(() => useServiceRoutes(existing.id));
    expect(result.current.every((r) => r.service_id === existing.id)).toBe(true);
  });
});
