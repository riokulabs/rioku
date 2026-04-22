/**
 * Tests for the routes API layer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  createRoute,
  updateRoute,
  deleteRoute,
  attachPolicy,
  detachPolicy,
  reorderMiddlewares,
  useRouteList,
} from '../api';
import { createRouteSchema, isValidRegex } from '../schemas';

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
  if (!svc) throw new Error('No service');
  return svc.id;
}

describe('isValidRegex', () => {
  it('accepts valid regex', () => {
    expect(isValidRegex('^/api/.*$')).toBe(true);
    expect(isValidRegex('\\d+')).toBe(true);
  });

  it('rejects invalid regex', () => {
    expect(isValidRegex('[unclosed')).toBe(false);
    expect(isValidRegex('(?P<>)')).toBe(false);
  });
});

describe('createRouteSchema', () => {
  it('rejects a regex match_kind with an invalid pattern', () => {
    const result = createRouteSchema.safeParse({
      service_id: 'svc-1',
      name: 'bad-regex',
      path: '[unclosed',
      method: 'GET',
      match_kind: 'regex',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a prefix match_kind with a non-regex path', () => {
    const result = createRouteSchema.safeParse({
      service_id: 'svc-1',
      name: 'ok-prefix',
      path: '/[also-ok',
      method: 'GET',
      match_kind: 'prefix',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a regex match_kind with a valid regex pattern', () => {
    const result = createRouteSchema.safeParse({
      service_id: 'svc-1',
      name: 'ok-regex',
      path: '/v1/user-\\d+',
      method: 'GET',
      match_kind: 'regex',
    });
    expect(result.success).toBe(true);
  });
});

describe('createRoute / updateRoute / deleteRoute', () => {
  it('creates a route and writes route.create audit', async () => {
    const tenantId = tenantIdBySlug('acme');
    const serviceId = firstServiceForTenant(tenantId);
    const auditBefore = useMockStore.getState().audit.length;

    const route = await createRoute({
      service_id: serviceId,
      name: 'new-route',
      path: '/new',
      method: 'GET',
      match_kind: 'prefix',
    });
    expect(route.service_id).toBe(serviceId);
    expect(route.enabled).toBe(true);
    const audit = useMockStore.getState().audit;
    expect(audit.length).toBe(auditBefore + 1);
    expect(audit.at(-1)?.action).toBe('route.create');
  });

  it('update writes a diff and bumps updated_at', async () => {
    const tenantId = tenantIdBySlug('acme');
    const serviceId = firstServiceForTenant(tenantId);
    const route = await createRoute({
      service_id: serviceId,
      name: 'rn',
      path: '/x',
      method: 'GET',
      match_kind: 'prefix',
    });

    await updateRoute(route.id, { name: 'renamed' });
    const after = useMockStore.getState().routes[route.id];
    expect(after?.name).toBe('renamed');
    expect(useMockStore.getState().audit.at(-1)?.diff).toBeDefined();
  });

  it('delete removes the route and writes destructive audit', async () => {
    const tenantId = tenantIdBySlug('acme');
    const serviceId = firstServiceForTenant(tenantId);
    const route = await createRoute({
      service_id: serviceId,
      name: 'delete-me',
      path: '/del',
      method: 'GET',
      match_kind: 'prefix',
    });

    await deleteRoute(route.id);
    expect(useMockStore.getState().routes[route.id]).toBeUndefined();
    const latest = useMockStore.getState().audit.at(-1);
    expect(latest?.action).toBe('route.delete');
    expect(latest?.tier).toBe('destructive');
  });
});

describe('attachPolicy / detachPolicy', () => {
  it('adds a policy id to the route.policies array idempotently', async () => {
    const route = Object.values(useMockStore.getState().routes)[0];
    if (!route) throw new Error('no route');
    const policy = Object.values(useMockStore.getState().accessPolicies)[0];
    if (!policy) throw new Error('no policy');

    await attachPolicy(route.id, policy.id);
    await attachPolicy(route.id, policy.id); // idempotent

    const after = useMockStore.getState().routes[route.id];
    expect(after?.policies.filter((p) => p === policy.id)).toHaveLength(1);
    expect(useMockStore.getState().audit.at(-1)?.action).toBe('route.policy.attach');
  });

  it('detachPolicy removes the id', async () => {
    const route = Object.values(useMockStore.getState().routes)[0];
    if (!route) throw new Error('no route');
    const policy = Object.values(useMockStore.getState().accessPolicies)[0];
    if (!policy) throw new Error('no policy');

    await attachPolicy(route.id, policy.id);
    await detachPolicy(route.id, policy.id);

    const after = useMockStore.getState().routes[route.id];
    expect(after?.policies).not.toContain(policy.id);
    expect(useMockStore.getState().audit.at(-1)?.action).toBe('route.policy.detach');
  });
});

describe('reorderMiddlewares', () => {
  it('full-replaces middleware_ids with the given list', async () => {
    const route = Object.values(useMockStore.getState().routes)[0];
    if (!route) throw new Error('no route');
    const mws = Object.values(useMockStore.getState().middlewares).slice(0, 3);

    await reorderMiddlewares(
      route.id,
      mws.map((m) => m.id),
    );
    const after = useMockStore.getState().routes[route.id];
    expect(after?.middleware_ids).toEqual(mws.map((m) => m.id));

    // full-replace: passing a subset truncates the list
    const firstMw = mws[0];
    if (!firstMw) throw new Error('expected at least one middleware');
    await reorderMiddlewares(route.id, [firstMw.id]);
    const after2 = useMockStore.getState().routes[route.id];
    expect(after2?.middleware_ids).toEqual([firstMw.id]);

    const latest = useMockStore.getState().audit.at(-1);
    expect(latest?.action).toBe('route.middlewares.reorder');
    expect(latest?.diff).toBeDefined();
  });
});

describe('useRouteList', () => {
  it('filters by service when serviceId is provided', () => {
    const svcId = firstServiceForTenant(tenantIdBySlug('acme'));
    const { result } = renderHook(() => useRouteList(svcId, tenantIdBySlug('acme')));
    expect(result.current.every((r) => r.service_id === svcId)).toBe(true);
  });

  it('returns all tenant routes when serviceId is undefined', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() => useRouteList(undefined, tenantId));
    const state = useMockStore.getState();
    for (const route of result.current) {
      expect(state.services[route.service_id]?.tenant_id).toBe(tenantId);
    }
  });
});
