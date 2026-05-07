/**
 * MSW handlers for AI Tools tests. The handlers operate against an
 * in-memory store mirroring the daemon shape (camelCase keys).
 */
import { http, HttpResponse } from 'msw';

const BASE = '/api/v1';

interface DaemonTool {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  kind: string;
  schema?: Record<string, unknown>;
  dangerous?: boolean;
  enabled: boolean;
  mcpServerId?: string | null;
  httpEndpoint?: string | null;
  httpEndpointMethod?: 'GET' | 'POST';
  httpEndpointAuthHeader?: string;
  createdAt: string;
  updatedAt: string;
}

let store: Record<string, DaemonTool> = {};
let agentRefs: Record<string, string[]> = {};
let counter = 1;
let invokeImpl: ((id: string, body: unknown) => unknown) | null = null;
let testImpl: ((id: string, body: unknown) => unknown) | null = null;

function nextId(): string {
  return `aitool-${String(counter++)}`;
}

export function resetToolStore(seed?: DaemonTool[]): void {
  store = {};
  agentRefs = {};
  counter = 1;
  invokeImpl = null;
  testImpl = null;
  if (seed) {
    for (const t of seed) store[t.id] = t;
  }
}

export function setToolAgentRefs(toolId: string, agentIds: string[]): void {
  agentRefs[toolId] = agentIds;
}

export function setInvokeImpl(impl: (id: string, body: unknown) => unknown): void {
  invokeImpl = impl;
}

export function setTestImpl(impl: (id: string, body: unknown) => unknown): void {
  testImpl = impl;
}

export function makeTool(over: Partial<DaemonTool> = {}): DaemonTool {
  const id = over.id ?? nextId();
  const now = new Date().toISOString();
  return {
    id,
    tenantId: over.tenantId ?? 'tenant-acme',
    name: over.name ?? `tool-${id}`,
    description: over.description ?? 'Sample tool',
    kind: over.kind ?? 'native',
    schema: over.schema ?? { type: 'object', properties: {} },
    dangerous: over.dangerous ?? false,
    enabled: over.enabled ?? true,
    mcpServerId: over.mcpServerId ?? null,
    httpEndpoint: over.httpEndpoint ?? null,
    createdAt: over.createdAt ?? now,
    updatedAt: over.updatedAt ?? now,
    ...(over.httpEndpointMethod !== undefined
      ? { httpEndpointMethod: over.httpEndpointMethod }
      : {}),
    ...(over.httpEndpointAuthHeader !== undefined
      ? { httpEndpointAuthHeader: over.httpEndpointAuthHeader }
      : {}),
  };
}

export const aiToolHandlers = [
  http.get(`${BASE}/t/:tenant/ai/tools`, () => {
    const items = Object.values(store);
    return HttpResponse.json({ items, total: items.length });
  }),

  http.get(`${BASE}/t/:tenant/ai/tools/:id`, ({ params }) => {
    const t = store[params.id as string];
    if (!t) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(t);
  }),

  http.post(`${BASE}/t/:tenant/ai/tools`, async ({ params, request }) => {
    const body = (await request.json()) as Partial<DaemonTool>;
    const id = nextId();
    const t = makeTool({
      ...body,
      id,
      tenantId: `tenant-${params.tenant as string}`,
    });
    store[id] = t;
    return HttpResponse.json(t, { status: 201 });
  }),

  http.patch(`${BASE}/t/:tenant/ai/tools/:id`, async ({ params, request }) => {
    const id = params.id as string;
    const cur = store[id];
    if (!cur) return new HttpResponse(null, { status: 404 });
    const patch = (await request.json()) as Partial<DaemonTool>;
    const updated: DaemonTool = {
      ...cur,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    store[id] = updated;
    return HttpResponse.json(updated);
  }),

  http.put(`${BASE}/t/:tenant/ai/tools/:id`, async ({ params, request }) => {
    const id = params.id as string;
    const cur = store[id];
    if (!cur) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as Partial<DaemonTool>;
    const updated: DaemonTool = {
      ...cur,
      ...body,
      id,
      updatedAt: new Date().toISOString(),
    };
    store[id] = updated;
    return HttpResponse.json(updated);
  }),

  http.delete(`${BASE}/t/:tenant/ai/tools/:id`, ({ params }) => {
    const id = params.id as string;
    if (!store[id]) return new HttpResponse(null, { status: 404 });
    const refs = agentRefs[id] ?? [];
    if (refs.length > 0) {
      return HttpResponse.json(
        {
          title: 'tool in use',
          status: 409,
          fields: { agentIds: refs, bindingIds: [] },
        },
        { status: 409, headers: { 'content-type': 'application/problem+json' } },
      );
    }
    const { [id]: _removed, ...rest } = store;
    void _removed;
    store = rest;
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${BASE}/t/:tenant/ai/tools/:id/agents`, ({ params }) => {
    const refs = agentRefs[params.id as string] ?? [];
    return HttpResponse.json({
      items: refs.map((agentId) => ({ agentId })),
      total: refs.length,
    });
  }),

  http.post(`${BASE}/t/:tenant/ai/tools/:id/test`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as unknown;
    if (testImpl) {
      const out = testImpl(params.id as string, body);
      return HttpResponse.json(out as Record<string, unknown>);
    }
    return HttpResponse.json({ ok: true, toolId: params.id as string });
  }),

  http.post(`${BASE}/t/:tenant/ai/tools/:id/invoke`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as unknown;
    if (invokeImpl) {
      const out = invokeImpl(params.id as string, body);
      if (out instanceof Response) return out;
      return HttpResponse.json(out as Record<string, unknown>);
    }
    return HttpResponse.json({
      ok: true,
      output: { echo: body },
      duration_ms: 12,
    });
  }),

  http.get(`${BASE}/t/:tenant/audit`, () => {
    // Empty audit feed by default; tests override via server.use(...).
    return HttpResponse.json({ items: [] });
  }),
];
