/**
 * AI Tools API — wired to the real daemon via TanStack Query + customFetch.
 *
 * Endpoints:
 *   GET    /api/v1/t/{tenant}/ai/tools
 *   POST   /api/v1/t/{tenant}/ai/tools
 *   GET    /api/v1/t/{tenant}/ai/tools/{id}
 *   PUT    /api/v1/t/{tenant}/ai/tools/{id}
 *   PATCH  /api/v1/t/{tenant}/ai/tools/{id}
 *   DELETE /api/v1/t/{tenant}/ai/tools/{id}
 *   GET    /api/v1/t/{tenant}/ai/tools/{id}/agents
 *   POST   /api/v1/t/{tenant}/ai/tools/{id}/test     (legacy stub)
 *   POST   /api/v1/t/{tenant}/ai/tools/{id}/invoke   (real test invocation)
 *
 * Server payloads use camelCase (Orval-generated `AITool`); UI uses the
 * snake_case `AiTool` type. The adapters in this file translate both ways.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';
import type { AiTool, AiAgent } from '@/api/resources';
import type { AITool as DaemonAITool } from '@/api/generated/schemas';
import { ToolInUseError } from './types';
import type {
  CreateToolInput,
  TestToolResult,
  InvokeToolResult,
  ToolFilter,
  UpdateToolInput,
} from './types';

// ─── Query key factory ────────────────────────────────────────────────────────

export const toolKeys = {
  all: (tenant: string) => ['ai-tools', tenant] as const,
  list: (tenant: string) => ['ai-tools', tenant, 'list'] as const,
  detail: (tenant: string, id: string) => ['ai-tools', tenant, 'detail', id] as const,
  agents: (tenant: string, id: string) => ['ai-tools', tenant, 'agents', id] as const,
  audit: (tenant: string, id: string) => ['ai-tools', tenant, 'audit', id] as const,
};

// ─── URL helpers ──────────────────────────────────────────────────────────────

function toolBase(tenant: string): string {
  return `/t/${tenant}/ai/tools`;
}

// ─── Adapters ─────────────────────────────────────────────────────────────────

interface DaemonAIToolFull extends DaemonAITool {
  // Daemon may attach this when the response is enriched; fall through if absent.
  httpEndpointMethod?: 'GET' | 'POST';
  httpEndpointAuthHeader?: string;
}

/** Convert daemon (camelCase) → UI (snake_case). */
export function fromDaemon(t: DaemonAIToolFull): AiTool {
  const httpUrl = typeof t.httpEndpoint === 'string' ? t.httpEndpoint : null;
  const out: AiTool = {
    id: t.id,
    tenant_id: t.tenantId,
    name: t.name,
    description: t.description ?? '',
    schema: (t.schema as Record<string, unknown> | undefined) ?? {},
    kind: ((['native', 'mcp', 'http'] as const).includes(t.kind as 'native' | 'mcp' | 'http')
      ? t.kind
      : 'native') as AiTool['kind'],
    dangerous: t.dangerous ?? false,
    enabled: t.enabled,
    created_at: t.createdAt,
  };
  if (t.mcpServerId) out.mcp_server_id = t.mcpServerId;
  if (httpUrl !== null) {
    out.http_endpoint = {
      url: httpUrl,
      method: t.httpEndpointMethod ?? 'POST',
      ...(t.httpEndpointAuthHeader !== undefined ? { auth_header: t.httpEndpointAuthHeader } : {}),
    };
  }
  return out;
}

interface CreateBody {
  name: string;
  description: string;
  kind: string;
  schema: Record<string, unknown>;
  dangerous: boolean;
  enabled: boolean;
  mcpServerId?: string | null;
  httpEndpoint?: string | null;
  httpEndpointMethod?: 'GET' | 'POST';
  httpEndpointAuthHeader?: string;
}

function toDaemonCreate(input: CreateToolInput): CreateBody {
  const body: CreateBody = {
    name: input.name,
    description: input.description,
    kind: input.kind,
    schema: input.schema,
    dangerous: input.dangerous ?? false,
    enabled: input.enabled ?? true,
  };
  if (input.mcp_server_id !== undefined) body.mcpServerId = input.mcp_server_id;
  if (input.http_endpoint !== undefined) {
    body.httpEndpoint = input.http_endpoint.url;
    body.httpEndpointMethod = input.http_endpoint.method;
    if (input.http_endpoint.auth_header !== undefined) {
      body.httpEndpointAuthHeader = input.http_endpoint.auth_header;
    }
  }
  return body;
}

function toDaemonUpdate(input: UpdateToolInput): Partial<CreateBody> {
  const body: Partial<CreateBody> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.description !== undefined) body.description = input.description;
  if (input.kind !== undefined) body.kind = input.kind;
  if (input.schema !== undefined) body.schema = input.schema;
  if (input.dangerous !== undefined) body.dangerous = input.dangerous;
  if (input.enabled !== undefined) body.enabled = input.enabled;
  if (input.mcp_server_id !== undefined) body.mcpServerId = input.mcp_server_id;
  if (input.http_endpoint !== undefined) {
    body.httpEndpoint = input.http_endpoint.url;
    body.httpEndpointMethod = input.http_endpoint.method;
    if (input.http_endpoint.auth_header !== undefined) {
      body.httpEndpointAuthHeader = input.http_endpoint.auth_header;
    }
  }
  return body;
}

// ─── Selectors (query hooks) ──────────────────────────────────────────────────

/** Fetch + filter tools for a tenant. Filter applied client-side after fetch. */
export function useToolList(tenant: string, filter: ToolFilter): AiTool[] {
  const { data } = useQuery({
    queryKey: toolKeys.list(tenant),
    queryFn: () =>
      customFetch<{ items?: DaemonAIToolFull[]; total?: number }>({
        url: toolBase(tenant),
        method: 'GET',
      }),
    enabled: tenant.length > 0,
  });

  const tools = (data?.items ?? []).map(fromDaemon);
  const search = filter.search.toLowerCase().trim();
  return tools.filter((t) => {
    if (filter.kinds.length > 0 && !filter.kinds.includes(t.kind)) return false;
    if (filter.enabled !== undefined && t.enabled !== filter.enabled) return false;
    if (filter.dangerous !== undefined && t.dangerous !== filter.dangerous) return false;
    if (filter.mcp_server_id !== undefined && t.mcp_server_id !== filter.mcp_server_id) {
      return false;
    }
    if (search) {
      const nameMatch = t.name.toLowerCase().includes(search);
      const descMatch = t.description.toLowerCase().includes(search);
      if (!nameMatch && !descMatch) return false;
    }
    return true;
  });
}

/** Fetch a single tool by id. */
export function useToolDetail(tenant: string, id: string): AiTool | undefined {
  const { data } = useQuery({
    queryKey: toolKeys.detail(tenant, id),
    queryFn: () =>
      customFetch<DaemonAIToolFull>({
        url: `${toolBase(tenant)}/${id}`,
        method: 'GET',
      }),
    enabled: tenant.length > 0 && id.length > 0,
  });
  return data ? fromDaemon(data) : undefined;
}

/**
 * Fetch agent ids that reference this tool. Returns a sparse `AiAgent`-like
 * shape (only `id` populated) since the daemon endpoint exposes ids only.
 */
export function useToolAgents(tenant: string, id: string): Pick<AiAgent, 'id'>[] {
  const { data } = useQuery({
    queryKey: toolKeys.agents(tenant, id),
    queryFn: () =>
      customFetch<{ items?: { agentId?: string }[]; total?: number }>({
        url: `${toolBase(tenant)}/${id}/agents`,
        method: 'GET',
      }),
    enabled: tenant.length > 0 && id.length > 0,
  });
  const items = data?.items ?? [];
  return items
    .filter((a): a is { agentId: string } => typeof a.agentId === 'string')
    .map((a) => ({ id: a.agentId }));
}

/**
 * Fetch audit entries for this tool. Falls back to an empty list if the
 * daemon returns 404 / 501.
 */
export function useToolAudit(
  tenant: string,
  id: string,
): { items: { id: string; action: string; actor_id: string; at: string }[] } {
  const { data } = useQuery({
    queryKey: toolKeys.audit(tenant, id),
    queryFn: () =>
      customFetch<{
        items?: { id: string; action: string; actor_id: string; at: string }[];
      }>({
        url: `/t/${tenant}/audit`,
        method: 'GET',
        params: { resource_type: 'ai-tool', resource_id: id, limit: 25 },
      }).catch(() => ({ items: [] })),
    enabled: tenant.length > 0 && id.length > 0,
  });
  return { items: data?.items ?? [] };
}

// ─── Mutations (hooks) ────────────────────────────────────────────────────────

export function useCreateTool(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateToolInput) =>
      customFetch<DaemonAIToolFull>({
        url: toolBase(tenant),
        method: 'POST',
        data: toDaemonCreate(input),
      }).then(fromDaemon),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: toolKeys.all(tenant) });
    },
  });
}

export function useUpdateTool(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateToolInput }) =>
      customFetch<DaemonAIToolFull>({
        url: `${toolBase(tenant)}/${id}`,
        method: 'PATCH',
        data: toDaemonUpdate(input),
      }).then(fromDaemon),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: toolKeys.all(tenant) });
    },
  });
}

export function useDeleteTool(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      customFetch<unknown>({
        url: `${toolBase(tenant)}/${id}`,
        method: 'DELETE',
      }).then(() => undefined),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: toolKeys.all(tenant) });
    },
  });
}

// ─── Imperative wrappers ──────────────────────────────────────────────────────

export async function createTool(tenant: string, input: CreateToolInput): Promise<AiTool> {
  const raw = await customFetch<DaemonAIToolFull>({
    url: toolBase(tenant),
    method: 'POST',
    data: toDaemonCreate(input),
  });
  return fromDaemon(raw);
}

export async function updateTool(
  tenant: string,
  id: string,
  input: UpdateToolInput,
): Promise<AiTool> {
  const raw = await customFetch<DaemonAIToolFull>({
    url: `${toolBase(tenant)}/${id}`,
    method: 'PATCH',
    data: toDaemonUpdate(input),
  });
  return fromDaemon(raw);
}

export async function deleteTool(tenant: string, id: string): Promise<void> {
  // We bypass `customFetch` for 409 handling — the shared mutator drops the
  // problem+json body for non-validation statuses, and we need `agentIds` /
  // `bindingIds` from it to render a targeted "in use" notification.
  const base: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';
  const url = `${base}${toolBase(tenant)}/${id}`;
  const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
  if (res.ok || res.status === 204) return;
  if (res.status === 409) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore parse failure — fall through to a bare ToolInUseError
    }
    const rec = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const fields = (rec.fields ?? {}) as Record<string, unknown>;
    const agentIdsRaw = fields.agentIds;
    const bindingIdsRaw = fields.bindingIds;
    const agentIds = Array.isArray(agentIdsRaw)
      ? agentIdsRaw.filter((v): v is string => typeof v === 'string')
      : [];
    const bindingIds = Array.isArray(bindingIdsRaw)
      ? bindingIdsRaw.filter((v): v is string => typeof v === 'string')
      : [];
    throw new ToolInUseError(agentIds, bindingIds);
  }
  throw new Error(`Failed to delete tool: HTTP ${String(res.status)}`);
}

/**
 * Schema-validation stub (legacy `/test` endpoint). Returns ok+result on
 * success or ok=false+error on validation failure.
 */
export async function testTool(
  tenant: string,
  id: string,
  sampleInput: Record<string, unknown>,
): Promise<TestToolResult> {
  return customFetch<TestToolResult>({
    url: `${toolBase(tenant)}/${id}/test`,
    method: 'POST',
    data: { input: sampleInput },
  });
}

/**
 * Real tool invocation. Sends the supplied JSON object to the daemon and
 * returns the rendered output, duration and (where applicable) token usage.
 */
export async function invokeTool(
  tenant: string,
  id: string,
  input: Record<string, unknown>,
): Promise<InvokeToolResult> {
  return customFetch<InvokeToolResult>({
    url: `${toolBase(tenant)}/${id}/invoke`,
    method: 'POST',
    data: { input },
  });
}

export function useInvokeTool(tenant: string) {
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Record<string, unknown> }) =>
      invokeTool(tenant, id, input),
  });
}
