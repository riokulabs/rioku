/**
 * Tests for the API keys feature (1e.93).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { createApiKey, revokeApiKey, deleteApiKey, rotateApiKey, useApiKeyList } from '../api';

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function getTenantId(slug: string): string {
  const state = useMockStore.getState();
  const tenant = Object.values(state.tenants).find((t) => t.slug === slug);
  if (!tenant) throw new Error(`No tenant with slug ${slug}`);
  return tenant.id;
}

describe('createApiKey', () => {
  it('creates a key and returns a full value', async () => {
    const tenantId = getTenantId('acme');
    const result = await createApiKey(tenantId, 'test-key', ['read']);

    expect(result.fullValue).toContain('sk_acme_');
    expect(result.fullValue.length).toBeGreaterThan(20);
    expect(result.key.name).toBe('test-key');
    expect(result.key.scope).toEqual(['read']);
    expect(result.key.revoked).toBe(false);
  });

  it('full key value is different from prefix stored', async () => {
    const tenantId = getTenantId('acme');
    const result = await createApiKey(tenantId, 'test-key', ['read']);

    // prefix is first chars + '…' in display, full value is longer
    expect(result.fullValue.length).toBeGreaterThan(result.key.prefix.length);
  });

  it('persists the key to the store', async () => {
    const tenantId = getTenantId('acme');
    const result = await createApiKey(tenantId, 'persist-test', ['admin']);

    const stored = useMockStore.getState().apiKeys[result.key.id];
    expect(stored).toBeDefined();
    expect(stored?.name).toBe('persist-test');
  });

  it('emits an api-key:create audit entry', async () => {
    const tenantId = getTenantId('acme');
    const auditBefore = useMockStore.getState().audit.length;

    await createApiKey(tenantId, 'audit-test', ['read']);

    const auditAfter = useMockStore.getState().audit;
    expect(auditAfter.length).toBeGreaterThan(auditBefore);
    const entry = auditAfter[auditAfter.length - 1];
    expect(entry?.action).toBe('api-key:create');
  });
});

describe('revokeApiKey', () => {
  it('sets revoked=true on the key', async () => {
    const state = useMockStore.getState();
    const key = Object.values(state.apiKeys).find((k) => !k.revoked);
    if (!key) throw new Error('No non-revoked key');

    await revokeApiKey(key.id);

    const updated = useMockStore.getState().apiKeys[key.id];
    expect(updated?.revoked).toBe(true);
  });

  it('emits an api-key:revoke audit entry', async () => {
    const state = useMockStore.getState();
    const key = Object.values(state.apiKeys).find((k) => !k.revoked);
    if (!key) throw new Error('No non-revoked key');
    const auditBefore = state.audit.length;

    await revokeApiKey(key.id);

    const auditAfter = useMockStore.getState().audit;
    const entry = auditAfter[auditAfter.length - 1];
    expect(entry?.action).toBe('api-key:revoke');
    expect(auditAfter.length).toBeGreaterThan(auditBefore);
  });
});

describe('deleteApiKey', () => {
  it('removes the key from the store', async () => {
    const state = useMockStore.getState();
    const key = Object.values(state.apiKeys)[0];
    if (!key) throw new Error('No key');

    await deleteApiKey(key.id);

    expect(useMockStore.getState().apiKeys[key.id]).toBeUndefined();
  });
});

describe('rotateApiKey', () => {
  it('returns a new full value', async () => {
    const state = useMockStore.getState();
    const key = Object.values(state.apiKeys).find((k) => !k.revoked);
    if (!key) throw new Error('No active key');
    const oldPrefix = key.prefix;

    const result = await rotateApiKey(key.id);

    expect(result.fullValue).toBeTruthy();
    expect(result.key.prefix).not.toBe(oldPrefix);
    expect(result.key.revoked).toBe(false);
  });

  it('emits an api-key:rotate audit entry', async () => {
    const state = useMockStore.getState();
    const key = Object.values(state.apiKeys).find((k) => !k.revoked);
    if (!key) throw new Error('No active key');
    const auditBefore = state.audit.length;

    await rotateApiKey(key.id);

    const auditAfter = useMockStore.getState().audit;
    const entry = auditAfter[auditAfter.length - 1];
    expect(entry?.action).toBe('api-key:rotate');
    expect(auditAfter.length).toBeGreaterThan(auditBefore);
  });
});

describe('useApiKeyList', () => {
  it('returns keys for the given tenant', () => {
    const tenantId = getTenantId('acme');
    const { result } = renderHook(() => useApiKeyList(tenantId, { status: 'all' }));
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.every((k) => k.tenant_id === tenantId)).toBe(true);
  });

  it('filters by status: only active keys when status=active', () => {
    const tenantId = getTenantId('acme');
    const { result } = renderHook(() => useApiKeyList(tenantId, { status: 'active' }));
    expect(result.current.every((k) => k.display_status === 'active')).toBe(true);
  });

  it('filters by status: only revoked keys when status=revoked', () => {
    const tenantId = getTenantId('acme');

    // Revoke one key first
    const state = useMockStore.getState();
    const acmeKey = Object.values(state.apiKeys).find(
      (k) => k.tenant_id === tenantId && !k.revoked,
    );
    if (acmeKey) {
      state.updateEntity('apiKeys', acmeKey.id, { revoked: true });
    }

    const { result } = renderHook(() => useApiKeyList(tenantId, { status: 'revoked' }));
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.every((k) => k.display_status === 'revoked')).toBe(true);
  });
});
