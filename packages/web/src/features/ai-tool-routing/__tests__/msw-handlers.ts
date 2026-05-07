/**
 * MSW handlers + helpers for the AI tool-binding feature tests.
 *
 * Mirrors the pattern used by the AI Providers feature (in-memory store
 * keyed by id, idempotent reset, deterministic ids). Handlers cover the
 * binding CRUD endpoints, the bulk-attach action, the preview-condition
 * action, and the agent + tool list endpoints used by the components for
 * id → name denormalisation.
 */
import { http, HttpResponse } from 'msw';

const BASE = '*/api/v1';

interface WireBinding {
  id: string;
  tenantId: string;
  agentId: string;
  toolId: string;
  condition: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface WireAgent {
  id: string;
  tenantId: string;
  name: string;
  model: string;
  systemPrompt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface WireTool {
  id: string;
  tenantId: string;
  name: string;
  kind: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const initial = () => ({ bindings: {} as Record<string, WireBinding>, idCounter: 1 });
let store = initial();

const agentsStore: Record<string, WireAgent> = {};
const toolsStore: Record<string, WireTool> = {};

function nextId(): string {
  return `bnd-${String(store.idCounter++)}`;
}

const NOW = '2026-05-06T00:00:00.000Z';

export function makeBinding(over: Partial<WireBinding> = {}): WireBinding {
  return {
    id: over.id ?? nextId(),
    tenantId: over.tenantId ?? 'tenant-acme',
    agentId: over.agentId ?? 'aiagent-1',
    toolId: over.toolId ?? 'aitool-1',
    condition: over.condition ?? '',
    enabled: over.enabled ?? true,
    createdAt: over.createdAt ?? NOW,
    updatedAt: over.updatedAt ?? NOW,
  };
}

export function makeAgent(over: Partial<WireAgent> = {}): WireAgent {
  const id = over.id ?? `aiagent-${String(Object.keys(agentsStore).length + 1)}`;
  return {
    id,
    tenantId: over.tenantId ?? 'tenant-acme',
    name: over.name ?? `Agent ${id}`,
    model: over.model ?? 'gpt-4',
    systemPrompt: over.systemPrompt ?? '',
    enabled: over.enabled ?? true,
    createdAt: over.createdAt ?? NOW,
    updatedAt: over.updatedAt ?? NOW,
  };
}

export function makeTool(over: Partial<WireTool> = {}): WireTool {
  const id = over.id ?? `aitool-${String(Object.keys(toolsStore).length + 1)}`;
  return {
    id,
    tenantId: over.tenantId ?? 'tenant-acme',
    name: over.name ?? `Tool ${id}`,
    kind: over.kind ?? 'http',
    enabled: over.enabled ?? true,
    createdAt: over.createdAt ?? NOW,
    updatedAt: over.updatedAt ?? NOW,
  };
}

export function resetBindingStore(seed?: WireBinding[]): void {
  store = initial();
  if (seed) {
    for (const b of seed) {
      store.bindings[b.id] = b;
    }
  }
}

export function resetAgentToolStores(opts: {
  agents?: WireAgent[];
  tools?: WireTool[];
}): void {
  for (const k of Object.keys(agentsStore)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete agentsStore[k];
  }
  for (const k of Object.keys(toolsStore)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete toolsStore[k];
  }
  for (const a of opts.agents ?? []) agentsStore[a.id] = a;
  for (const t of opts.tools ?? []) toolsStore[t.id] = t;
}

export function readBindingStore(): Record<string, WireBinding> {
  return store.bindings;
}

export const aiToolBindingHandlers = [
  http.get(`${BASE}/t/:tenant/ai/tool-bindings`, () => {
    const items = Object.values(store.bindings);
    return HttpResponse.json({ items, total: items.length });
  }),

  http.get(`${BASE}/t/:tenant/ai/tool-bindings/:id`, ({ params }) => {
    const b = store.bindings[params.id as string];
    if (!b) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(b);
  }),

  http.post(`${BASE}/t/:tenant/ai/tool-bindings`, async ({ request, params }) => {
    const body = (await request.json()) as Partial<WireBinding>;
    const id = nextId();
    const tenantId = `tenant-${params.tenant as string}`;
    const created: WireBinding = {
      id,
      tenantId,
      agentId: body.agentId ?? '',
      toolId: body.toolId ?? '',
      condition: body.condition ?? '',
      enabled: body.enabled ?? true,
      createdAt: NOW,
      updatedAt: NOW,
    };
    store.bindings[id] = created;
    return HttpResponse.json(created, { status: 201 });
  }),

  http.put(`${BASE}/t/:tenant/ai/tool-bindings/:id`, async ({ request, params }) => {
    const id = params.id as string;
    const existing = store.bindings[id];
    if (!existing) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as Partial<WireBinding>;
    const updated: WireBinding = {
      ...existing,
      ...body,
      updatedAt: NOW,
    };
    store.bindings[id] = updated;
    return HttpResponse.json(updated);
  }),

  http.delete(`${BASE}/t/:tenant/ai/tool-bindings/:id`, ({ params }) => {
    const id = params.id as string;
    if (!store.bindings[id]) return new HttpResponse(null, { status: 404 });
    const { [id]: _gone, ...rest } = store.bindings;
    void _gone;
    store.bindings = rest;
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${BASE}/t/:tenant/ai/tool-bindings/bulk-attach`, async ({ request, params }) => {
    const body = (await request.json()) as { agentId: string; toolIds: string[] };
    const tenantId = `tenant-${params.tenant as string}`;
    const created: WireBinding[] = [];
    const existingByPair = new Set(
      Object.values(store.bindings).map((b) => `${b.agentId}::${b.toolId}`),
    );
    for (const toolId of body.toolIds) {
      const key = `${body.agentId}::${toolId}`;
      if (existingByPair.has(key)) continue;
      const id = nextId();
      const b: WireBinding = {
        id,
        tenantId,
        agentId: body.agentId,
        toolId,
        condition: '',
        enabled: true,
        createdAt: NOW,
        updatedAt: NOW,
      };
      store.bindings[id] = b;
      created.push(b);
    }
    return HttpResponse.json({ items: created, total: created.length });
  }),

  http.post(
    `${BASE}/t/:tenant/ai/tool-bindings/preview-condition`,
    async ({ request }) => {
      const body = (await request.json()) as { condition?: string };
      const cond = body.condition ?? '';
      // Heuristic mock for the daemon's cel-go evaluator. Anything containing
      // an unbalanced paren is reported as a syntax error; otherwise we
      // deterministically return matched=true if the condition mentions
      // `admin` and false otherwise. Empty conditions short-circuit before
      // hitting this endpoint via api.ts.
      const opens = (cond.match(/\(/g) ?? []).length;
      const closes = (cond.match(/\)/g) ?? []).length;
      if (opens !== closes) {
        return HttpResponse.json(
          {
            type: 'about:blank',
            title: 'unbalanced parentheses in CEL expression',
            status: 400,
          },
          { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }
      const matched = cond.includes('admin');
      return HttpResponse.json({ condition: cond, matched });
    },
  ),

  // Agents + tools list endpoints — used by useAgentRefs / useToolRefs.
  http.get(`${BASE}/t/:tenant/ai/agents`, () => {
    const items = Object.values(agentsStore);
    return HttpResponse.json({ items, total: items.length });
  }),
  http.get(`${BASE}/t/:tenant/ai/tools`, () => {
    const items = Object.values(toolsStore);
    return HttpResponse.json({ items, total: items.length });
  }),

  // Audit log — feature tests use a no-op default response.
  http.get(`${BASE}/audit`, () =>
    HttpResponse.json({ entries: [], items: [], nextPageToken: '' }),
  ),
];
