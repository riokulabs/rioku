/**
 * Tests for the AI providers API layer — real daemon endpoints via MSW.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { server } from '@/test/msw-server';
import {
  createProvider,
  updateProvider,
  deleteProvider,
  testProvider,
  addModel,
  updateModel,
  removeModel,
} from '../api';
import { aiProviderHandlers, resetProviderStore, makeProvider } from './msw-handlers';

const TENANT = 'acme';

beforeEach(() => {
  resetProviderStore();
  server.use(...aiProviderHandlers);
});

describe('createProvider', () => {
  it('creates a provider and stores credential prefix only', async () => {
    const p = await createProvider(TENANT, {
      name: 'Test Provider',
      kind: 'openai',
      base_url: 'https://api.test.local/v1',
      description: 'A test provider',
      credential: 'sk-secret-value-do-not-store',
      enabled: true,
    });

    expect(p.name).toBe('Test Provider');
    expect(p.credential_ref.prefix).toBe('sk-secret-va');
    expect(p.models).toHaveLength(0);
  });

  it('creates a provider with minimal fields', async () => {
    const p = await createProvider(TENANT, {
      name: 'minimal-provider',
      kind: 'custom',
      base_url: 'https://example.com/v1',
      credential: 'tok-abc',
    });
    expect(p).toHaveProperty('id');
    expect(p.kind).toBe('custom');
  });
});

describe('updateProvider', () => {
  it('updates fields', async () => {
    const created = await createProvider(TENANT, {
      name: 'Before',
      kind: 'openai',
      base_url: 'https://api.openai.com/v1',
      credential: 'sk-orig',
    });
    const updated = await updateProvider(TENANT, created.id, { name: 'After' });
    expect(updated.name).toBe('After');
  });

  it('rotates credential when new credential provided', async () => {
    const created = await createProvider(TENANT, {
      name: 'RotateMe',
      kind: 'openai',
      base_url: 'https://api.openai.com/v1',
      credential: 'sk-old-cred',
    });
    const updated = await updateProvider(TENANT, created.id, { credential: 'sk-new-credential' });
    expect(updated.credential_ref.prefix).toBe("sk-new-crede");
  });
});

describe('deleteProvider', () => {
  it('deletes a provider', async () => {
    const p = await createProvider(TENANT, {
      name: 'ToDelete',
      kind: 'openai',
      base_url: 'https://api.openai.com/v1',
      credential: 'sk-del',
    });
    await expect(deleteProvider(TENANT, p.id)).resolves.toBeUndefined();
  });
});

describe('testProvider', () => {
  it('returns ok=true shape from MSW handler', async () => {
    const seed = makeProvider({ id: 'aiprov-test-1' });
    resetProviderStore([seed]);
    server.use(...aiProviderHandlers);

    const result = await testProvider(TENANT, 'aiprov-test-1');
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('latency_ms');
    expect(result).toHaveProperty('tested_at');
    expect(result.ok).toBe(true);
  });
});

describe('addModel', () => {
  it('adds a model to a provider', async () => {
    const p = await createProvider(TENANT, {
      name: 'ModelHost',
      kind: 'openai',
      base_url: 'https://api.openai.com/v1',
      credential: 'sk-mh',
    });
    const updated = await addModel(TENANT, p.id, {
      upstream_id: 'gpt-4o',
      alias: 'gpt4o',
      rate_limit_rpm: 60,
      daily_quota_tokens: 100_000,
      enabled: true,
    });
    expect(updated.models).toHaveLength(1);
    expect(updated.models[0]?.alias).toBe('gpt4o');
    expect(updated.models[0]?.rate_limit_rpm).toBe(60);
  });
});

describe('updateModel', () => {
  it('updates model rate limits and enabled state', async () => {
    const p = await createProvider(TENANT, {
      name: 'UP',
      kind: 'openai',
      base_url: 'https://api.openai.com/v1',
      credential: 'sk-up',
    });
    await addModel(TENANT, p.id, {
      upstream_id: 'u-1',
      alias: 'u-alias',
      rate_limit_rpm: 60,
      daily_quota_tokens: 10_000,
    });
    const after = await updateModel(TENANT, p.id, 'u-1', { rate_limit_rpm: 120, enabled: false });
    expect(after.models[0]?.rate_limit_rpm).toBe(120);
    expect(after.models[0]?.enabled).toBe(false);
  });
});

describe('removeModel', () => {
  it('removes a model successfully', async () => {
    const p = await createProvider(TENANT, {
      name: 'RP',
      kind: 'openai',
      base_url: 'https://api.rp.local/v1',
      credential: 'sk-rp',
    });
    await addModel(TENANT, p.id, {
      upstream_id: 'r-1',
      alias: 'r-alias',
      rate_limit_rpm: null,
      daily_quota_tokens: null,
    });
    const after = await removeModel(TENANT, p.id, 'r-1');
    expect(after.models).toHaveLength(0);
  });
});
