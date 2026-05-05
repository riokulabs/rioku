/**
 * API keys API — backed by the Zustand mock store.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { logAuditEntry } from '@/api/resources/audit';
import { makeIdFactory } from '@/lib/id-generator';
import type { ApiKey } from '@/api/resources';
import type { ApiKeyWithMeta, ApiKeyFilter } from './types';

const nextApiKeyId = makeIdFactory('apikey-new');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function getCurrentActorId(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function getCurrentTenantId(): string {
  return useMockStore.getState().currentTenantId ?? '';
}

/** Compute relative "N units ago" summary (no external dep) */
function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${String(hrs)}h ago`;
  const days = Math.floor(hrs / 24);
  return `${String(days)}d ago`;
}

function daysDiff(isoStr: string): number {
  const diff = new Date(isoStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function enrichApiKey(key: ApiKey): ApiKeyWithMeta {
  const isExpired = key.expires_at != null && new Date(key.expires_at) < new Date();
  const display_status: ApiKeyWithMeta['display_status'] = key.revoked
    ? 'revoked'
    : isExpired
      ? 'expired'
      : 'active';
  return {
    ...key,
    last_used_summary: key.last_used ? relativeTime(key.last_used) : undefined,
    expires_in_days: key.expires_at ? daysDiff(key.expires_at) : undefined,
    display_status,
  };
}

/** Generate a random-looking API key value (shown once on creation) */
function generateKeyValue(tenantSlug: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 32; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `sk_${tenantSlug}_${rand}`;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useApiKeyList(tenantId: string, filter: ApiKeyFilter): ApiKeyWithMeta[] {
  const apiKeys = useMockStore((s) => s.apiKeys);

  const results: ApiKeyWithMeta[] = [];
  for (const key of Object.values(apiKeys)) {
    if (key.tenant_id !== tenantId) continue;
    const enriched = enrichApiKey(key);
    if (filter.status !== 'all' && enriched.display_status !== filter.status) continue;
    results.push(enriched);
  }
  return results;
}

export function useApiKey(id: string): ApiKeyWithMeta | null {
  const key = useMockStore((s) => s.apiKeys[id]);
  return key ? enrichApiKey(key) : null;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useApiKeyMutations() {
  return { createApiKey, revokeApiKey, deleteApiKey, rotateApiKey };
}

export interface CreateApiKeyResult {
  key: ApiKeyWithMeta;
  /** Full secret value — shown once, never stored */
  fullValue: string;
}

export async function createApiKey(
  tenantId: string,
  name: string,
  scope: string[],
  expiresAt?: string,
): Promise<CreateApiKeyResult> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const actorId = getCurrentActorId();
  const tenant = Object.values(state.tenants).find((t) => t.id === tenantId);
  const tenantSlug = tenant?.slug ?? 'key';

  const fullValue = generateKeyValue(tenantSlug);
  const prefix = fullValue.slice(0, fullValue.lastIndexOf('_') + 9);

  const id = nextApiKeyId();
  const apiKey: ApiKey = {
    id,
    tenant_id: tenantId,
    user_id: actorId,
    name,
    prefix,
    scope,
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    revoked: false,
    created_at: now(),
  };
  state.addEntity('apiKeys', apiKey);

  logAuditEntry({
    tenant_id: tenantId,
    actor_id: actorId,
    action: 'api-key:create',
    resource_type: 'api-key',
    resource_id: id,
    tier: 'write',
  });

  return { key: enrichApiKey(apiKey), fullValue };
}

export async function revokeApiKey(id: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const key = state.apiKeys[id];
  if (!key) return;

  state.updateEntity('apiKeys', id, { revoked: true });

  logAuditEntry({
    tenant_id: key.tenant_id,
    actor_id: getCurrentActorId(),
    action: 'api-key:revoke',
    resource_type: 'api-key',
    resource_id: id,
    tier: 'destructive',
  });
}

export async function deleteApiKey(id: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const key = state.apiKeys[id];
  if (!key) return;
  const tenantId = key.tenant_id;

  state.deleteEntity('apiKeys', id);

  logAuditEntry({
    tenant_id: tenantId,
    actor_id: getCurrentActorId(),
    action: 'api-key:delete',
    resource_type: 'api-key',
    resource_id: id,
    tier: 'destructive',
  });
}

export interface RotateApiKeyResult {
  key: ApiKeyWithMeta;
  /** New full secret value — shown once */
  fullValue: string;
}

export async function rotateApiKey(id: string): Promise<RotateApiKeyResult> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const key = state.apiKeys[id];
  if (!key) throw new Error('API key not found');

  const tenant = Object.values(state.tenants).find((t) => t.id === key.tenant_id);
  const tenantSlug = tenant?.slug ?? 'key';

  const fullValue = generateKeyValue(tenantSlug);
  const prefix = fullValue.slice(0, fullValue.lastIndexOf('_') + 9);

  state.updateEntity('apiKeys', id, { prefix, revoked: false });

  logAuditEntry({
    tenant_id: key.tenant_id,
    actor_id: getCurrentActorId(),
    action: 'api-key:rotate',
    resource_type: 'api-key',
    resource_id: id,
    tier: 'destructive',
  });

  const updated = useMockStore.getState().apiKeys[id];
  return { key: enrichApiKey(updated ?? key), fullValue };
}

// Keep getCurrentTenantId available for components
export { getCurrentTenantId };
