/**
 * API keys API — backed by the real daemon via Orval-generated React Query hooks.
 *
 * Stage-2 plan-02 / Item 02-002. The stage-1 mock-store-backed surface
 * has been removed; every selector and mutation now goes against
 * `/api/v1/t/{tenant}/api-keys`. Capture-once secret: the daemon emits
 * the plaintext key in the create + rotate response exactly once, so
 * the mutator return values still expose `{ key, fullValue }` and the
 * UI surfaces it via <SecretCaptureModal>.
 */
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListAPIKeys,
  useGetAPIKey,
  useCreateAPIKey,
  useDeleteAPIKey,
  useRevokeAPIKey,
  useRotateAPIKey,
  getListAPIKeysQueryKey,
  getGetAPIKeyQueryKey,
} from '@/api/generated/api-keys/api-keys';
import type { ApiKey } from '@/api/resources';
import type { ApiKeyWithMeta, ApiKeyFilter } from './types';

// The Orval-generated wire types ship with `@ts-nocheck`, so we
// re-declare the (small) subset we read here to keep eslint happy.
interface RawAPIKey {
  id?: string;
  tenantId?: string;
  ownerId?: string;
  name?: string;
  prefix?: string;
  scopes?: string[];
  expiresAt?: string;
  createdAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
}

function adaptAPIKey(raw: RawAPIKey, tenantIdFallback: string): ApiKey {
  const revokedAt = raw.revokedAt ?? '';
  const result: ApiKey = {
    id: raw.id ?? '',
    tenant_id: raw.tenantId ?? tenantIdFallback,
    user_id: raw.ownerId ?? '',
    name: raw.name ?? '',
    prefix: raw.prefix ?? '',
    scope: raw.scopes ?? [],
    revoked: revokedAt !== '',
    created_at: raw.createdAt ?? new Date(0).toISOString(),
  };
  if (raw.expiresAt) result.expires_at = raw.expiresAt;
  if (raw.lastUsedAt) result.last_used = raw.lastUsedAt;
  return result;
}

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

export function useApiKeyList(tenantId: string, filter: ApiKeyFilter): ApiKeyWithMeta[] {
  const query = useListAPIKeys(tenantId, { query: { enabled: !!tenantId } });
  return useMemo(() => {
    const raw = (query.data?.data.apiKeys ?? []) as RawAPIKey[];
    const out: ApiKeyWithMeta[] = [];
    for (const r of raw) {
      const enriched = enrichApiKey(adaptAPIKey(r, tenantId));
      if (filter.status !== 'all' && enriched.display_status !== filter.status) continue;
      out.push(enriched);
    }
    return out;
  }, [query.data, filter.status, tenantId]);
}

export function useApiKey(tenantId: string, id: string): ApiKeyWithMeta | null {
  const query = useGetAPIKey(tenantId, id, {
    query: { enabled: !!tenantId && !!id },
  });
  return useMemo(() => {
    const raw = query.data?.data;
    if (!raw?.id) return null;
    return enrichApiKey(adaptAPIKey(raw, tenantId));
  }, [query.data, tenantId]);
}

interface RotateAPIKey200Body {
  id?: string;
  key?: string;
  prefix?: string;
}

export interface CreateApiKeyResult {
  key: ApiKeyWithMeta;
  fullValue: string;
}

export interface RotateApiKeyResult {
  key: ApiKeyWithMeta;
  fullValue: string;
}

export function useApiKeyMutations(tenantId: string) {
  const qc = useQueryClient();
  const create = useCreateAPIKey();
  const del = useDeleteAPIKey();
  const revoke = useRevokeAPIKey();
  const rotate = useRotateAPIKey();

  function invalidateList(): Promise<void> {
    return qc.invalidateQueries({ queryKey: getListAPIKeysQueryKey(tenantId) });
  }
  function invalidateOne(id: string): Promise<void> {
    return qc.invalidateQueries({ queryKey: getGetAPIKeyQueryKey(tenantId, id) });
  }

  async function createApiKey(
    explicitTenantId: string,
    name: string,
    scope: string[],
    expiresAt?: string,
  ): Promise<CreateApiKeyResult> {
    const tenant = explicitTenantId || tenantId;
    const data: { name: string; scopes?: string; expires?: string } = { name };
    if (scope.length > 0) data.scopes = scope.join(',');
    if (expiresAt) {
      const ms = new Date(expiresAt).getTime() - Date.now();
      if (ms > 0) {
        const hours = Math.max(1, Math.ceil(ms / 3_600_000));
        data.expires = `${String(hours)}h`;
      }
    }
    const resp = await create.mutateAsync({ tenant, data });
    await invalidateList();
    // Orval emits `data: void` for the create endpoint despite the daemon
    // returning a JSON body — cast through the actual 201 schema.
    const body = resp.data;
    const fullValue = body.key ?? '';
    const id = body.id ?? '';
    const synthetic: ApiKey = {
      id,
      tenant_id: tenant,
      user_id: '',
      name,
      prefix: body.prefix ?? '',
      scope,
      revoked: false,
      created_at: new Date().toISOString(),
      ...(expiresAt ? { expires_at: expiresAt } : {}),
    };
    return { key: enrichApiKey(synthetic), fullValue };
  }

  async function revokeApiKey(id: string): Promise<void> {
    await revoke.mutateAsync({ tenant: tenantId, id });
    await Promise.all([invalidateList(), invalidateOne(id)]);
  }

  async function deleteApiKey(id: string): Promise<void> {
    await del.mutateAsync({ tenant: tenantId, id });
    await invalidateList();
  }

  async function rotateApiKey(id: string): Promise<RotateApiKeyResult> {
    const resp = await rotate.mutateAsync({ tenant: tenantId, id });
    await Promise.all([invalidateList(), invalidateOne(id)]);
    const body = resp.data as unknown as RotateAPIKey200Body;
    const fullValue = body.key ?? '';
    const newId = body.id ?? id;
    const synthetic: ApiKey = {
      id: newId,
      tenant_id: tenantId,
      user_id: '',
      name: '',
      prefix: body.prefix ?? '',
      scope: [],
      revoked: false,
      created_at: new Date().toISOString(),
    };
    return { key: enrichApiKey(synthetic), fullValue };
  }

  return { createApiKey, revokeApiKey, deleteApiKey, rotateApiKey };
}
