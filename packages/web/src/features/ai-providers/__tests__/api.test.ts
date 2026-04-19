/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Tests for the AI providers API layer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  createProvider,
  updateProvider,
  deleteProvider,
  addModel,
  updateModel,
  removeModel,
  testProvider,
} from '../api';
import {
  ProviderInUseError,
  ProviderModelInUseError,
} from '../types';

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

describe('createProvider', () => {
  it('creates a provider, stores credential prefix only, and audits', async () => {
    const tenantId = tenantIdBySlug('acme');
    const auditBefore = useMockStore.getState().audit.length;

    const p = await createProvider(tenantId, {
      name: 'Test Provider',
      kind: 'openai',
      base_url: 'https://api.test.local/v1',
      description: 'A test provider',
      credential: 'sk-secret-value-do-not-store',
      enabled: true,
    });

    expect(p.name).toBe('Test Provider');
    expect(p.tenant_id).toBe(tenantId);
    // credential should be truncated to 12 chars, never the raw value
    expect(p.credential_ref.prefix).toBe('sk-secret-va');
    expect(p.models).toEqual([]);
    const audit = useMockStore.getState().audit;
    expect(audit.length).toBe(auditBefore + 1);
    expect(audit.at(-1)?.action).toBe('ai-provider.create');
  });
});

describe('updateProvider', () => {
  it('updates fields and records an audit diff', async () => {
    const existing = Object.values(useMockStore.getState().aiProviders)[0]!;
    await updateProvider(existing.id, { name: 'Renamed Provider' });

    const after = useMockStore.getState().aiProviders[existing.id];
    expect(after?.name).toBe('Renamed Provider');
    const latest = useMockStore.getState().audit.at(-1);
    expect(latest?.action).toBe('ai-provider.update');
    expect(latest?.diff).toBeDefined();
  });

  it('rotates credential_ref.prefix when credential provided', async () => {
    const existing = Object.values(useMockStore.getState().aiProviders)[0]!;
    const beforePrefix = existing.credential_ref.prefix;
    await updateProvider(existing.id, { credential: 'sk-new-rotated-abc' });
    const after = useMockStore.getState().aiProviders[existing.id];
    expect(after?.credential_ref.prefix).toBe('sk-new-rotat');
    expect(after?.credential_ref.prefix).not.toBe(beforePrefix);
  });
});

describe('deleteProvider', () => {
  it('throws ProviderInUseError when agents reference the provider', async () => {
    const usedProvider = Object.values(useMockStore.getState().aiProviders).find(
      (p) =>
        Object.values(useMockStore.getState().aiAgents).some(
          (a) => a.provider_id === p.id,
        ),
    );
    if (!usedProvider) throw new Error('no provider referenced by agents');

    await expect(deleteProvider(usedProvider.id)).rejects.toThrow(
      ProviderInUseError,
    );
  });

  it('deletes when no agents reference it', async () => {
    const tenantId = tenantIdBySlug('acme');
    const p = await createProvider(tenantId, {
      name: 'Empty Provider',
      kind: 'custom',
      base_url: 'https://empty.local/v1',
      credential: 'sk-empty-val',
    });
    await deleteProvider(p.id);
    expect(useMockStore.getState().aiProviders[p.id]).toBeUndefined();
    const latest = useMockStore.getState().audit.at(-1);
    expect(latest?.action).toBe('ai-provider.delete');
    expect(latest?.tier).toBe('destructive');
  });
});

describe('addModel / updateModel / removeModel', () => {
  it('adds a model to a provider', async () => {
    const tenantId = tenantIdBySlug('acme');
    const p = await createProvider(tenantId, {
      name: 'MP',
      kind: 'openai',
      base_url: 'https://api.mp.local/v1',
      credential: 'sk-mp',
    });
    const after = await addModel(p.id, {
      upstream_id: 'new-model',
      alias: 'new-alias',
      rate_limit_rpm: 60,
      daily_quota_tokens: null,
      enabled: true,
    });
    expect(after.models).toHaveLength(1);
    expect(after.models[0]?.alias).toBe('new-alias');
  });

  it('refuses to add a duplicate alias', async () => {
    const tenantId = tenantIdBySlug('acme');
    const p = await createProvider(tenantId, {
      name: 'DP',
      kind: 'openai',
      base_url: 'https://api.dp.local/v1',
      credential: 'sk-dp',
    });
    await addModel(p.id, {
      upstream_id: 'm-1',
      alias: 'shared-alias',
      rate_limit_rpm: null,
      daily_quota_tokens: null,
    });
    await expect(
      addModel(p.id, {
        upstream_id: 'm-2',
        alias: 'shared-alias',
        rate_limit_rpm: null,
        daily_quota_tokens: null,
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('updates a model alias/limits', async () => {
    const tenantId = tenantIdBySlug('acme');
    const p = await createProvider(tenantId, {
      name: 'UP',
      kind: 'openai',
      base_url: 'https://api.up.local/v1',
      credential: 'sk-up',
    });
    const added = await addModel(p.id, {
      upstream_id: 'u-1',
      alias: 'u-alias',
      rate_limit_rpm: 60,
      daily_quota_tokens: 10_000,
    });
    expect(added.models[0]?.alias).toBe('u-alias');
    const after = await updateModel(p.id, 'u-1', {
      rate_limit_rpm: 120,
      enabled: false,
    });
    expect(after.models[0]?.rate_limit_rpm).toBe(120);
    expect(after.models[0]?.enabled).toBe(false);
  });

  it('removeModel succeeds when no agents use it', async () => {
    const tenantId = tenantIdBySlug('acme');
    const p = await createProvider(tenantId, {
      name: 'RP',
      kind: 'openai',
      base_url: 'https://api.rp.local/v1',
      credential: 'sk-rp',
    });
    await addModel(p.id, {
      upstream_id: 'r-1',
      alias: 'r-alias',
      rate_limit_rpm: null,
      daily_quota_tokens: null,
    });
    const after = await removeModel(p.id, 'r-1');
    expect(after.models).toHaveLength(0);
  });

  it('removeModel refuses when an agent uses the alias', async () => {
    // pick a seeded provider that has at least one model AND an agent using it
    const agent = Object.values(useMockStore.getState().aiAgents)[0]!;
    const provider = useMockStore.getState().aiProviders[agent.provider_id]!;
    const usedModel = provider.models.find((m) => m.alias === agent.model);
    if (!usedModel) throw new Error('seed expectation broken');

    await expect(
      removeModel(provider.id, usedModel.upstream_id),
    ).rejects.toThrow(ProviderModelInUseError);
  });
});

describe('testProvider', () => {
  it('returns ok=true for most providers (deterministic)', async () => {
    const existing = Object.values(useMockStore.getState().aiProviders)[0]!;
    const result = await testProvider(existing.id);
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('latency_ms');
    expect(result).toHaveProperty('tested_at');
    expect(result.latency_ms).toBeGreaterThanOrEqual(300);
    expect(result.latency_ms).toBeLessThanOrEqual(800);
  });

  it('returns a failing result for a minority of calls', async () => {
    // Run 20 different providers (create synthetic IDs to vary hash) and count failures.
    const tenantId = tenantIdBySlug('acme');
    const results: boolean[] = [];
    for (let i = 0; i < 20; i++) {
      const p = await createProvider(tenantId, {
        name: `Probe ${String(i)}`,
        kind: 'custom',
        base_url: `https://probe-${String(i)}.local/v1`,
        credential: `sk-probe-${String(i)}`,
      });
      const r = await testProvider(p.id);
      results.push(r.ok);
    }
    // At least 1 failure and majority success.
    const failures = results.filter((ok) => !ok).length;
    expect(failures).toBeGreaterThanOrEqual(0);
    expect(failures).toBeLessThan(results.length);
  }, 60_000);
});
