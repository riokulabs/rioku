/**
 * AI MCP Servers API — wired to the real daemon via Orval-generated hooks
 * and the shared `customFetch` mutator.
 *
 * Endpoints:
 *   GET    /api/v1/t/{tenant}/ai/mcp-servers
 *   POST   /api/v1/t/{tenant}/ai/mcp-servers
 *   GET    /api/v1/t/{tenant}/ai/mcp-servers/{id}
 *   PUT    /api/v1/t/{tenant}/ai/mcp-servers/{id}
 *   DELETE /api/v1/t/{tenant}/ai/mcp-servers/{id}
 *   POST   /api/v1/t/{tenant}/ai/mcp-servers/{id}/test
 *   GET    /api/v1/t/{tenant}/ai/mcp-servers/{id}/tools
 *
 * Public names:
 *   useMcpServerList, useMcpServerDetail, useMcpServerTools,
 *   createMcpServer, updateMcpServer, deleteMcpServer, testMcpServer.
 *
 * The legacy `*McpServer` mutators take a tenant slug as their first arg
 * (rather than the previous mock-only `(id, ...)` shape) — call sites have
 * been updated. New mutation hooks (useCreateMcpServer / useUpdateMcpServer /
 * useDeleteMcpServer / useTestMcpServer) wrap the Orval-generated mutations
 * with query-cache invalidation.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMCPServer as orvalCreate,
  deleteMCPServer as orvalDelete,
  getMCPServer as orvalGet,
  listMCPServerTools as orvalListTools,
  listMCPServers as orvalList,
  testMCPServer as orvalTest,
  updateMCPServer as orvalUpdate,
} from '@/api/generated/ai-mcp-servers/ai-mcp-servers';
import type {
  ListMCPServerTools200ItemsItem,
  MCPServer as DaemonMCPServer,
  TestMCPServer200,
} from '@/api/generated/schemas';
import type { McpServer } from '@/api/resources';
import type {
  CreateMcpServerInput,
  McpServerFilter,
  TestMcpServerResult,
  UpdateMcpServerInput,
} from './types';

// ─── Query key factory ────────────────────────────────────────────────────────

export const mcpServerKeys = {
  all: (tenant: string) => ['ai-mcp-servers', tenant] as const,
  list: (tenant: string) => ['ai-mcp-servers', tenant, 'list'] as const,
  detail: (tenant: string, id: string) => ['ai-mcp-servers', tenant, 'detail', id] as const,
  tools: (tenant: string, id: string) => ['ai-mcp-servers', tenant, 'tools', id] as const,
};

// ─── Adapters ─────────────────────────────────────────────────────────────────

const VALID_AUTH_KINDS: McpServer['auth_kind'][] = ['none', 'bearer', 'api-key'];
const VALID_HEALTHS: McpServer['health'][] = ['healthy', 'degraded', 'unreachable', 'disabled'];

function asAuthKind(s: string | undefined): McpServer['auth_kind'] {
  if (s && (VALID_AUTH_KINDS as string[]).includes(s)) return s as McpServer['auth_kind'];
  return 'none';
}

function asHealth(s: string | undefined): McpServer['health'] {
  if (s && (VALID_HEALTHS as string[]).includes(s)) return s as McpServer['health'];
  return 'degraded';
}

/** Adapt the daemon's MCPServer (camelCase) into the local McpServer (snake_case). */
export function adaptDaemonMcpServer(d: DaemonMCPServer): McpServer {
  return {
    id: d.id,
    tenant_id: d.tenantId,
    name: d.name,
    url: d.url,
    auth_kind: asAuthKind(d.authKind),
    enabled: d.enabled,
    authorized_agent_ids: d.authorizedAgentIds ? [...d.authorizedAgentIds] : [],
    health: asHealth(d.health),
    exposed_tool_count: 0,
    created_at: d.createdAt,
    ...(d.lastCheckedAt ? { last_seen_at: d.lastCheckedAt } : {}),
  };
}

// customFetch returns either the JSON body or a `{ data, status, headers }`
// envelope depending on whether the call site went through orval. The
// generated functions return an envelope; normalize here.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function unwrapData<T>(res: unknown): T {
  if (res !== null && typeof res === 'object' && 'data' in (res as Record<string, unknown>)) {
    return (res as { data: T }).data;
  }
  return res as T;
}

// ─── Selector hooks ───────────────────────────────────────────────────────────

interface ListResult {
  items: McpServer[];
  isLoading: boolean;
  error: unknown;
}

/**
 * Filtered list of MCP servers for the given tenant.
 *
 * Returns a `McpServer[]` directly so existing call sites keep working.
 * For the reactive query state, use {@link useMcpServerListQuery}.
 */
export function useMcpServerList(tenant: string, filter: McpServerFilter): McpServer[] {
  const { items } = useMcpServerListQuery(tenant);
  return applyFilter(items, filter);
}

/** Reactive list query — exposes `isLoading`/`error` for richer UIs. */
export function useMcpServerListQuery(tenant: string): ListResult {
  const { data, isLoading, error } = useQuery({
    queryKey: mcpServerKeys.list(tenant),
    queryFn: async () => {
      const raw = await orvalList(tenant);
      const env = unwrapData<{ items?: DaemonMCPServer[] }>(raw);
      return (env.items ?? []).map(adaptDaemonMcpServer);
    },
    enabled: tenant !== '',
  });
  return { items: data ?? [], isLoading, error };
}

function applyFilter(items: McpServer[], filter: McpServerFilter): McpServer[] {
  const search = filter.search.toLowerCase().trim();
  const out: McpServer[] = [];
  for (const s of items) {
    if (filter.healths.length > 0 && !filter.healths.includes(s.health)) continue;
    if (filter.auth_kinds.length > 0 && !filter.auth_kinds.includes(s.auth_kind)) continue;
    if (filter.enabled !== undefined && s.enabled !== filter.enabled) continue;
    if (search) {
      const nameMatch = s.name.toLowerCase().includes(search);
      const descMatch = s.description?.toLowerCase().includes(search) ?? false;
      const urlMatch = s.url.toLowerCase().includes(search);
      if (!nameMatch && !descMatch && !urlMatch) continue;
    }
    out.push(s);
  }
  return out;
}

/** Single MCP server detail by id. */
export function useMcpServerDetail(tenant: string, id: string): McpServer | undefined {
  const { data } = useQuery({
    queryKey: mcpServerKeys.detail(tenant, id),
    queryFn: async () => {
      const raw = await orvalGet(tenant, id);
      const d = unwrapData<DaemonMCPServer>(raw);
      return adaptDaemonMcpServer(d);
    },
    enabled: tenant !== '' && id !== '',
  });
  return data;
}

/** Tools exposed by an MCP server (live, fetched). */
export function useMcpServerTools(
  tenant: string,
  id: string,
): {
  items: ListMCPServerTools200ItemsItem[];
  isLoading: boolean;
  error: unknown;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: mcpServerKeys.tools(tenant, id),
    queryFn: async () => {
      const raw = await orvalListTools(tenant, id);
      const env = unwrapData<{ items?: ListMCPServerTools200ItemsItem[] }>(raw);
      return env.items ?? [];
    },
    enabled: tenant !== '' && id !== '',
  });
  return { items: data ?? [], isLoading, error };
}

// ─── Mutation hooks ───────────────────────────────────────────────────────────

export function useCreateMcpServer(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMcpServerInput) => createMcpServer(tenant, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mcpServerKeys.all(tenant) });
    },
  });
}

export function useUpdateMcpServer(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMcpServerInput }) =>
      updateMcpServer(tenant, id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mcpServerKeys.all(tenant) });
    },
  });
}

export function useDeleteMcpServer(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMcpServer(tenant, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mcpServerKeys.all(tenant) });
    },
  });
}

export function useTestMcpServer(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => testMcpServer(tenant, id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: mcpServerKeys.detail(tenant, id) });
    },
  });
}

// ─── Imperative mutators (preserved public surface) ──────────────────────────

export async function createMcpServer(
  tenant: string,
  input: CreateMcpServerInput,
): Promise<McpServer> {
  const body = {
    name: input.name,
    url: input.url,
    authKind: input.auth_kind,
    ...(input.auth_credential !== undefined ? { authCredential: input.auth_credential } : {}),
  };
  const raw = await orvalCreate(tenant, body);
  return adaptDaemonMcpServer(unwrapData<DaemonMCPServer>(raw));
}

export async function updateMcpServer(
  tenant: string,
  id: string,
  input: UpdateMcpServerInput,
): Promise<McpServer> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.url !== undefined) body.url = input.url;
  if (input.auth_kind !== undefined) body.authKind = input.auth_kind;
  if (input.auth_credential !== undefined) body.authCredential = input.auth_credential;
  if (input.authorized_agent_ids !== undefined)
    body.authorizedAgentIds = [...input.authorized_agent_ids];
  if (input.enabled !== undefined) body.enabled = input.enabled;
  const raw = await orvalUpdate(tenant, id, body);
  return adaptDaemonMcpServer(unwrapData<DaemonMCPServer>(raw));
}

export async function deleteMcpServer(tenant: string, id: string): Promise<void> {
  await orvalDelete(tenant, id);
}

export async function testMcpServer(tenant: string, id: string): Promise<TestMcpServerResult> {
  const raw = await orvalTest(tenant, id);
  const body = unwrapData<TestMCPServer200>(raw);
  const result: TestMcpServerResult = {
    ok: body.ok,
    latency_ms: body.latencyMs,
  };
  if (body.error !== undefined) result.error = body.error;
  if (body.serverVersion !== undefined) result.server_version = body.serverVersion;
  return result;
}

export async function listMcpServerTools(
  tenant: string,
  id: string,
): Promise<ListMCPServerTools200ItemsItem[]> {
  const raw = await orvalListTools(tenant, id);
  const body = unwrapData<{ items?: ListMCPServerTools200ItemsItem[] }>(raw);
  return body.items ?? [];
}
