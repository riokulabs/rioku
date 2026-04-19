/**
 * Tests for the middlewares API layer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  createMiddleware,
  updateMiddleware,
  deleteMiddleware,
  useMiddlewareList,
} from '../api';
import { MiddlewareInUseError } from '../types';
import {
  middlewareConfigSchemas,
  rateLimitConfigSchema,
  authConfigSchema,
} from '../schemas';

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

describe('middlewareConfigSchemas', () => {
  it('exposes a schema per kind', () => {
    expect(Object.keys(middlewareConfigSchemas).sort()).toEqual(
      ['auth', 'cache', 'cors', 'custom', 'logging', 'rate-limit', 'transform'],
    );
  });

  it('rate-limit config schema validates full payload', () => {
    const result = rateLimitConfigSchema.safeParse({
      requests_per_minute: 1000,
      burst: 10,
      key_by: 'ip',
    });
    expect(result.success).toBe(true);
  });

  it('rate-limit config rejects out-of-range values', () => {
    const result = rateLimitConfigSchema.safeParse({
      requests_per_minute: 0,
      burst: -1,
      key_by: 'ip',
    });
    expect(result.success).toBe(false);
  });

  it('auth config schema validates', () => {
    const result = authConfigSchema.safeParse({ mode: 'bearer' });
    expect(result.success).toBe(true);
  });
});

describe('createMiddleware', () => {
  it('creates a middleware and appends audit entry', async () => {
    const tenantId = tenantIdBySlug('acme');
    const auditBefore = useMockStore.getState().audit.length;

    const mw = await createMiddleware(tenantId, {
      name: 'new-rl',
      kind: 'rate-limit',
      config: { requests_per_minute: 100, burst: 10, key_by: 'ip' },
      order_hint: 50,
    });
    expect(mw.kind).toBe('rate-limit');
    expect(mw.enabled).toBe(true);
    expect(useMockStore.getState().middlewares[mw.id]).toBeDefined();
    expect(useMockStore.getState().audit.length).toBe(auditBefore + 1);
    expect(useMockStore.getState().audit.at(-1)?.action).toBe('middleware.create');
  });
});

describe('updateMiddleware', () => {
  it('updates fields and records a diff', async () => {
    const tenantId = tenantIdBySlug('acme');
    const mw = await createMiddleware(tenantId, {
      name: 'orig',
      kind: 'cors',
      config: {},
    });
    await updateMiddleware(mw.id, { name: 'renamed' });
    const after = useMockStore.getState().middlewares[mw.id];
    expect(after?.name).toBe('renamed');
    expect(useMockStore.getState().audit.at(-1)?.diff).toBeDefined();
  });
});

describe('deleteMiddleware', () => {
  it('throws MiddlewareInUseError when a route references it', async () => {
    const state = useMockStore.getState();
    const middleware = Object.values(state.middlewares)[0];
    if (!middleware) throw new Error('no middleware');
    const route = Object.values(state.routes)[0];
    if (!route) throw new Error('no route');

    // Wire route to reference middleware
    state.updateEntity('routes', route.id, {
      middleware_ids: [...route.middleware_ids, middleware.id],
    });

    await expect(deleteMiddleware(middleware.id)).rejects.toBeInstanceOf(
      MiddlewareInUseError,
    );
    expect(useMockStore.getState().middlewares[middleware.id]).toBeDefined();
  });

  it('deletes and writes destructive audit when unreferenced', async () => {
    const tenantId = tenantIdBySlug('acme');
    const mw = await createMiddleware(tenantId, {
      name: 'deletable',
      kind: 'logging',
      config: { level: 'info', fields: [] },
    });

    await deleteMiddleware(mw.id);
    expect(useMockStore.getState().middlewares[mw.id]).toBeUndefined();
    const latest = useMockStore.getState().audit.at(-1);
    expect(latest?.action).toBe('middleware.delete');
    expect(latest?.tier).toBe('destructive');
  });
});

describe('useMiddlewareList', () => {
  it('returns middlewares for the tenant with stable ordering by order_hint', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() =>
      useMiddlewareList(tenantId, { search: '', kind: 'all', enabled: 'all' }),
    );
    expect(result.current.every((m) => m.tenant_id === tenantId)).toBe(true);
    for (let i = 1; i < result.current.length; i++) {
      const current = result.current[i];
      const prev = result.current[i - 1];
      if (!current || !prev) throw new Error('unexpected undefined');
      expect(current.order_hint).toBeGreaterThanOrEqual(prev.order_hint);
    }
  });

  it('filters by kind', () => {
    const tenantId = tenantIdBySlug('acme');
    const { result } = renderHook(() =>
      useMiddlewareList(tenantId, { search: '', kind: 'rate-limit', enabled: 'all' }),
    );
    expect(result.current.every((m) => m.kind === 'rate-limit')).toBe(true);
  });
});
