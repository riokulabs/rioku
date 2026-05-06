/**
 * MSW handlers for AI Providers tests.
 *
 * These override the default Orval-generated handlers and provide
 * realistic test data for the AI admin CRUD endpoints.
 */
import { http, HttpResponse } from 'msw';
import type { AiProvider } from '@/api/resources';

const BASE = '/api/v1';

// In-memory store for test handlers
let providerStore: Record<string, AiProvider> = {};
let idCounter = 1;

function makeId(): string {
  return `aiprov-${String(idCounter++)}`;
}

export function resetProviderStore(seed?: AiProvider[]): void {
  providerStore = {};
  idCounter = 1;
  if (seed) {
    for (const p of seed) {
      providerStore[p.id] = p;
    }
  }
}

export function makeProvider(overrides: Partial<AiProvider> = {}): AiProvider {
  const id = overrides.id ?? makeId();
  return {
    id,
    tenant_id: 'tenant-acme',
    name: overrides.name ?? `Provider ${id}`,
    kind: overrides.kind ?? 'openai',
    base_url: overrides.base_url ?? 'https://api.openai.com/v1',
    enabled: overrides.enabled ?? true,
    description: overrides.description,
    credential_ref: overrides.credential_ref ?? { prefix: 'sk-testXXX', created_at: new Date().toISOString() },
    models: overrides.models ?? [],
    created_at: overrides.created_at ?? new Date().toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
    ...overrides,
  };
}

export const aiProviderHandlers = [
  // List providers
  http.get(`${BASE}/t/:tenant/ai/providers`, ({ params }) => {
    const tenantSlug = params.tenant as string;
    const items = Object.values(providerStore).filter(
      (p) => p.tenant_id === `tenant-${tenantSlug}` || tenantSlug === 'acme',
    );
    return HttpResponse.json({ items, total: items.length });
  }),

  // Get single provider
  http.get(`${BASE}/t/:tenant/ai/providers/:id`, ({ params }) => {
    const p = providerStore[params.id as string];
    if (!p) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(p);
  }),

  // Create provider
  http.post(`${BASE}/t/:tenant/ai/providers`, async ({ params, request }) => {
    const body = await request.json() as Partial<AiProvider> & { credential?: string };
    const tenantSlug = params.tenant as string;
    const id = makeId();
    const now = new Date().toISOString();
    const p: AiProvider = {
      id,
      tenant_id: `tenant-${tenantSlug}`,
      name: body.name ?? 'Unnamed',
      kind: body.kind ?? 'openai',
      base_url: body.base_url ?? '',
      enabled: body.enabled ?? true,
      description: body.description,
      credential_ref: {
        prefix: (body.credential ?? 'sk-').slice(0, 12),
        created_at: now,
      },
      models: [],
      created_at: now,
      updated_at: now,
    };
    providerStore[id] = p;
    return HttpResponse.json(p, { status: 201 });
  }),

  // Update provider
  http.put(`${BASE}/t/:tenant/ai/providers/:id`, async ({ params, request }) => {
    const id = params.id as string;
    const existing = providerStore[id];
    if (!existing) return new HttpResponse(null, { status: 404 });
    const body = await request.json() as Partial<AiProvider> & { credential?: string };
    const updated: AiProvider = {
      ...existing,
      ...body,
      credential_ref: body.credential
        ? { prefix: body.credential.slice(0, 12), created_at: new Date().toISOString() }
        : existing.credential_ref,
      updated_at: new Date().toISOString(),
    };
    providerStore[id] = updated;
    return HttpResponse.json(updated);
  }),

  // Delete provider
  http.delete(`${BASE}/t/:tenant/ai/providers/:id`, ({ params }) => {
    const id = params.id as string;
    if (!providerStore[id]) return new HttpResponse(null, { status: 404 });
    delete providerStore[id];
    return new HttpResponse(null, { status: 204 });
  }),

  // Test provider
  http.post(`${BASE}/t/:tenant/ai/providers/:id/test`, ({ params }) => {
    const id = params.id as string;
    if (!providerStore[id]) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({
      ok: true,
      latency_ms: 120,
      tested_at: new Date().toISOString(),
    });
  }),

  // Add model
  http.post(`${BASE}/t/:tenant/ai/providers/:id/models`, async ({ params, request }) => {
    const id = params.id as string;
    const existing = providerStore[id];
    if (!existing) return new HttpResponse(null, { status: 404 });
    const body = await request.json() as { upstream_id: string; alias: string; rate_limit_rpm?: number | null; daily_quota_tokens?: number | null; enabled?: boolean };
    const newModel = {
      upstream_id: body.upstream_id,
      alias: body.alias,
      rate_limit_rpm: body.rate_limit_rpm ?? null,
      daily_quota_tokens: body.daily_quota_tokens ?? null,
      enabled: body.enabled ?? true,
    };
    const updated = { ...existing, models: [...existing.models, newModel], updated_at: new Date().toISOString() };
    providerStore[id] = updated;
    return HttpResponse.json(updated);
  }),

  // Update model
  http.put(`${BASE}/t/:tenant/ai/providers/:id/models/:modelId`, async ({ params, request }) => {
    const id = params.id as string;
    const modelId = params.modelId as string;
    const existing = providerStore[id];
    if (!existing) return new HttpResponse(null, { status: 404 });
    const body = await request.json() as { alias?: string; rate_limit_rpm?: number | null; daily_quota_tokens?: number | null; enabled?: boolean };
    const models = existing.models.map((m) =>
      m.upstream_id === modelId ? { ...m, ...body } : m,
    );
    const updated = { ...existing, models, updated_at: new Date().toISOString() };
    providerStore[id] = updated;
    return HttpResponse.json(updated);
  }),

  // Delete model
  http.delete(`${BASE}/t/:tenant/ai/providers/:id/models/:modelId`, ({ params }) => {
    const id = params.id as string;
    const modelId = params.modelId as string;
    const existing = providerStore[id];
    if (!existing) return new HttpResponse(null, { status: 404 });
    const updated = {
      ...existing,
      models: existing.models.filter((m) => m.upstream_id !== modelId),
      updated_at: new Date().toISOString(),
    };
    providerStore[id] = updated;
    return HttpResponse.json(updated);
  }),
];
