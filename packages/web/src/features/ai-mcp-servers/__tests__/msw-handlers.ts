/**
 * MSW handlers for AI MCP server tests.
 *
 * Override the default Orval-generated handlers (which return generated
 * faker payloads) with deterministic shapes a vitest can assert against.
 */
import { http, HttpResponse } from 'msw';
import type { MCPServer } from '@/api/generated/schemas';

// Use a wildcard host so the handlers match both:
//   - relative `/api/v1/...` (legacy customFetch form prepends BASE)
//   - relative `/api/v1/api/v1/...` (orval-generated form, where the
//     generated URL already contains `/api/v1/...` and the mutator BASE
//     prefix is applied a second time)
const BASE = '*/api/v1';

let serverStore: Record<string, MCPServer> = {};
let toolStore: Record<
  string,
  {
    id: string;
    name: string;
    description?: string;
    argSchema?: string;
    dangerous?: boolean;
    enabled?: boolean;
    mcpServerId: string;
  }
> = {};
let testResultOverride: {
  ok: boolean;
  latencyMs: number;
  error?: string;
  serverVersion?: string;
} | null = null;
let idCounter = 1;

function nextId(): string {
  idCounter += 1;
  return `mcpsrv-test-${String(idCounter)}`;
}

export function resetMcpServerStore(seed?: MCPServer[]): void {
  serverStore = {};
  toolStore = {};
  testResultOverride = null;
  idCounter = 1;
  if (seed) {
    for (const s of seed) {
      serverStore[s.id] = s;
    }
  }
}

export function seedTools(
  items: {
    id: string;
    name: string;
    description?: string;
    argSchema?: string;
    dangerous?: boolean;
    enabled?: boolean;
    mcpServerId: string;
  }[],
): void {
  for (const t of items) {
    toolStore[t.id] = t;
  }
}

export function setTestResult(result: {
  ok: boolean;
  latencyMs: number;
  error?: string;
  serverVersion?: string;
}): void {
  testResultOverride = result;
}

export function makeServer(overrides: Partial<MCPServer> = {}): MCPServer {
  const id = overrides.id ?? nextId();
  const now = new Date().toISOString();
  return {
    id,
    tenantId: overrides.tenantId ?? 'tenant-acme',
    name: overrides.name ?? `mcp-${id}`,
    url: overrides.url ?? `https://mcp.example.com/${id}`,
    authKind: overrides.authKind ?? 'bearer',
    health: overrides.health ?? 'healthy',
    enabled: overrides.enabled ?? true,
    authorizedAgentIds: overrides.authorizedAgentIds ?? [],
    lastCheckedAt: overrides.lastCheckedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

export const aiMcpServerHandlers = [
  // List
  http.get(`${BASE}/t/:tenant/ai/mcp-servers`, () => {
    const items = Object.values(serverStore);
    return HttpResponse.json({ items, total: items.length });
  }),

  // Get one
  http.get(`${BASE}/t/:tenant/ai/mcp-servers/:id`, ({ params }) => {
    const s = serverStore[params.id as string];
    if (!s) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(s);
  }),

  // Create
  http.post(`${BASE}/t/:tenant/ai/mcp-servers`, async ({ params, request }) => {
    const body = (await request.json()) as Partial<MCPServer> & { authCredential?: string };
    const tenantSlug = params.tenant as string;
    const id = nextId();
    const now = new Date().toISOString();
    const next: MCPServer = {
      id,
      tenantId: `tenant-${tenantSlug}`,
      name: body.name ?? 'unnamed',
      url: body.url ?? '',
      authKind: body.authKind ?? 'none',
      health: 'healthy',
      enabled: body.enabled ?? true,
      authorizedAgentIds: body.authorizedAgentIds ?? [],
      lastCheckedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    serverStore[id] = next;
    return HttpResponse.json(next, { status: 201 });
  }),

  // Update (PUT)
  http.put(`${BASE}/t/:tenant/ai/mcp-servers/:id`, async ({ params, request }) => {
    const id = params.id as string;
    const existing = serverStore[id];
    if (!existing) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as Partial<MCPServer> & { authCredential?: string };
    // Spread `existing` first; then overwrite only the keys that the body
    // explicitly carries — avoids stamping `undefined` over required fields.
    const next: MCPServer = { ...existing, updatedAt: new Date().toISOString() };
    if (body.name !== undefined) next.name = body.name;
    if (body.url !== undefined) next.url = body.url;
    if (body.authKind !== undefined) next.authKind = body.authKind;
    if (body.enabled !== undefined) next.enabled = body.enabled;
    if (body.authorizedAgentIds !== undefined) next.authorizedAgentIds = body.authorizedAgentIds;
    serverStore[id] = next;
    return HttpResponse.json(next);
  }),

  // Delete
  http.delete(`${BASE}/t/:tenant/ai/mcp-servers/:id`, ({ params }) => {
    const id = params.id as string;
    if (!serverStore[id]) return new HttpResponse(null, { status: 404 });
    const { [id]: _gone, ...rest } = serverStore;
    void _gone;
    serverStore = rest;
    return new HttpResponse(null, { status: 204 });
  }),

  // Test connectivity
  http.post(`${BASE}/t/:tenant/ai/mcp-servers/:id/test`, ({ params }) => {
    const id = params.id as string;
    if (!serverStore[id]) return new HttpResponse(null, { status: 404 });
    const result = testResultOverride ?? { ok: true, latencyMs: 42, serverVersion: 'mcp/0.1' };
    return HttpResponse.json({
      mcpServerId: id,
      ok: result.ok,
      latencyMs: result.latencyMs,
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.serverVersion !== undefined ? { serverVersion: result.serverVersion } : {}),
    });
  }),

  // List tools
  http.get(`${BASE}/t/:tenant/ai/mcp-servers/:id/tools`, ({ params }) => {
    const id = params.id as string;
    const items = Object.values(toolStore).filter((t) => t.mcpServerId === id);
    return HttpResponse.json({ items, total: items.length });
  }),
];
