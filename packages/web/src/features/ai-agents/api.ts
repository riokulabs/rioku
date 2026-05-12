/**
 * AI Agents API — wired to the real daemon.
 *
 * Public function names preserved from stage-1 (`useAgentList`,
 * `useAgentDetail`, `createAgent`, `updateAgent`, `deleteAgent`,
 * `rotateScopedCredential`, `useAgentTools`, `useAgentTraces`).
 *
 * The daemon's `AIAgent` schema is camelCase with a flat `guardrails` JSON
 * blob. Stage-1 components consumed `AiAgent` (snake_case + flattened
 * tool_ids/role_ids/temperature/max_tokens_per_request/stop_sequences). To
 * keep the existing UI working without a wholesale rewrite, this module
 * adapts the daemon shape into the legacy shape on read, and packs
 * legacy-shaped inputs back into `guardrails` on write.
 *
 * Endpoint base: `/api/v1/t/{tenant}/ai/agents`.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';
import type { AiAgent, AiTool, AiTrace } from '@/api/resources';
import type { AgentFilter, CreateAgentInput, InvokeAgentInput, UpdateAgentInput } from './types';

// ─── Types — daemon-side shapes ───────────────────────────────────────────────

interface DaemonGuardrails {
  toolIds?: string[];
  roleIds?: string[];
  maxTokensPerRequest?: number;
  temperature?: number;
  stopSequences?: string[];
  scopedCredentialPrefix?: string;
  scopedCredentialCreatedAt?: string;
}

interface DaemonAgent {
  id: string;
  tenantId: string;
  providerId?: string | null;
  name: string;
  description?: string;
  model: string;
  systemPrompt: string;
  guardrails?: DaemonGuardrails;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DaemonAgentListResponse {
  items?: DaemonAgent[];
  total?: number;
}

interface DaemonToolBindingItem {
  id?: string;
  toolId?: string;
  agentId?: string;
  enabled?: boolean;
}

interface DaemonAgentBindingsResponse {
  items?: DaemonToolBindingItem[];
  total?: number;
}

interface DaemonTrace extends Partial<AiTrace> {
  id: string;
  tenantId?: string;
  agentId?: string;
  providerId?: string;
}

interface DaemonAgentTracesResponse {
  items?: DaemonTrace[];
  total?: number;
}

interface DaemonRotateResponse {
  agentId?: string;
  ok?: boolean;
  newCredential?: string;
  prefix?: string;
  note?: string;
}

// ─── Adapters ─────────────────────────────────────────────────────────────────

function adaptAgent(d: DaemonAgent): AiAgent {
  const g = d.guardrails ?? {};
  const out: AiAgent = {
    id: d.id,
    tenant_id: d.tenantId,
    name: d.name,
    provider_id: d.providerId ?? '',
    model: d.model,
    system_prompt: d.systemPrompt,
    tool_ids: Array.isArray(g.toolIds) ? [...g.toolIds] : [],
    enabled: d.enabled,
    role_ids: Array.isArray(g.roleIds) ? [...g.roleIds] : [],
    max_tokens_per_request:
      typeof g.maxTokensPerRequest === 'number' ? g.maxTokensPerRequest : 4096,
    temperature: typeof g.temperature === 'number' ? g.temperature : 0.7,
    stop_sequences: Array.isArray(g.stopSequences) ? [...g.stopSequences] : [],
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };
  if (d.description !== undefined && d.description !== '') {
    out.description = d.description;
  }
  if (
    typeof g.scopedCredentialPrefix === 'string' &&
    typeof g.scopedCredentialCreatedAt === 'string'
  ) {
    out.scoped_credential_ref = {
      prefix: g.scopedCredentialPrefix,
      created_at: g.scopedCredentialCreatedAt,
    };
  }
  return out;
}

function packGuardrails(input: Partial<CreateAgentInput & UpdateAgentInput>): DaemonGuardrails {
  const g: DaemonGuardrails = {};
  if (input.tool_ids !== undefined) g.toolIds = [...input.tool_ids];
  if (input.role_ids !== undefined) g.roleIds = [...input.role_ids];
  if (input.max_tokens_per_request !== undefined) {
    g.maxTokensPerRequest = input.max_tokens_per_request;
  }
  if (input.temperature !== undefined) g.temperature = input.temperature;
  if (input.stop_sequences !== undefined) g.stopSequences = [...input.stop_sequences];
  if ('scoped_credential' in input && typeof input.scoped_credential === 'string') {
    const s = input.scoped_credential;
    g.scopedCredentialPrefix = s.slice(0, Math.min(12, s.length));
    g.scopedCredentialCreatedAt = new Date().toISOString();
  }
  return g;
}

// ─── Query key factory ────────────────────────────────────────────────────────

export const agentKeys = {
  all: (tenant: string) => ['ai-agents', tenant] as const,
  list: (tenant: string) => ['ai-agents', tenant, 'list'] as const,
  detail: (tenant: string, id: string) => ['ai-agents', tenant, 'detail', id] as const,
  tools: (tenant: string, id: string) => ['ai-agents', tenant, 'tools', id] as const,
  traces: (tenant: string, id: string) => ['ai-agents', tenant, 'traces', id] as const,
};

function agentBase(tenant: string): string {
  return `/t/${tenant}/ai/agents`;
}

// ─── Hooks: queries ───────────────────────────────────────────────────────────

/** Fetch + filter agents for a tenant (filter applied client-side after fetch). */
export function useAgentList(tenant: string, filter: AgentFilter): AiAgent[] {
  const { data } = useQuery({
    queryKey: agentKeys.list(tenant),
    queryFn: () =>
      customFetch<DaemonAgentListResponse>({
        url: agentBase(tenant),
        method: 'GET',
      }),
    enabled: tenant.length > 0,
  });
  const items = (data?.items ?? []).map(adaptAgent);
  const search = filter.search.toLowerCase().trim();
  return items.filter((a) => {
    if (filter.provider_ids.length > 0 && !filter.provider_ids.includes(a.provider_id)) {
      return false;
    }
    if (filter.enabled !== undefined && a.enabled !== filter.enabled) return false;
    if (filter.role_ids.length > 0) {
      if (!filter.role_ids.some((rid) => a.role_ids.includes(rid))) return false;
    }
    if (search.length > 0) {
      const nameMatch = a.name.toLowerCase().includes(search);
      const descMatch = a.description?.toLowerCase().includes(search) ?? false;
      const modelMatch = a.model.toLowerCase().includes(search);
      if (!nameMatch && !descMatch && !modelMatch) return false;
    }
    return true;
  });
}

/** Fetch a single agent. */
export function useAgentDetail(tenant: string, id: string): AiAgent | undefined {
  const { data } = useQuery({
    queryKey: agentKeys.detail(tenant, id),
    queryFn: () =>
      customFetch<DaemonAgent>({
        url: `${agentBase(tenant)}/${id}`,
        method: 'GET',
      }),
    enabled: tenant.length > 0 && id.length > 0,
  });
  return data ? adaptAgent(data) : undefined;
}

/** Tools bound to the agent. Returned as legacy AiTool[] (subset — id/name/kind). */
export function useAgentTools(tenant: string, id: string): AiTool[] {
  const { data } = useQuery({
    queryKey: agentKeys.tools(tenant, id),
    queryFn: () =>
      customFetch<DaemonAgentBindingsResponse>({
        url: `${agentBase(tenant)}/${id}/tools`,
        method: 'GET',
      }),
    enabled: tenant.length > 0 && id.length > 0,
  });
  const items = data?.items ?? [];
  return items
    .filter((b) => b.enabled !== false && typeof b.toolId === 'string')
    .map(
      (b): AiTool => ({
        id: b.toolId ?? '',
        tenant_id: '',
        name: b.toolId ?? '',
        description: '',
        schema: {},
        kind: 'http',
        dangerous: false,
        enabled: b.enabled !== false,
        created_at: '',
      }),
    );
}

/** Recent traces for an agent. */
export function useAgentTraces(tenant: string, id: string, limit = 20): AiTrace[] {
  const { data } = useQuery({
    queryKey: agentKeys.traces(tenant, id),
    queryFn: () =>
      customFetch<DaemonAgentTracesResponse>({
        url: `${agentBase(tenant)}/${id}/traces`,
        method: 'GET',
        params: { limit },
      }),
    enabled: tenant.length > 0 && id.length > 0,
  });
  // Daemon may return traces in a partial shape — coerce to AiTrace.
  const items = data?.items ?? [];
  return items
    .map(
      (t): AiTrace => ({
        id: t.id,
        tenant_id: t.tenantId ?? t.tenant_id ?? '',
        agent_id: t.agentId ?? t.agent_id ?? id,
        provider_id: t.providerId ?? t.provider_id ?? '',
        model: t.model ?? '',
        input_tokens: t.input_tokens ?? 0,
        output_tokens: t.output_tokens ?? 0,
        latency_ms: t.latency_ms ?? 0,
        status: t.status ?? 'success',
        at: t.at ?? '',
        prompt_text: t.prompt_text ?? '',
        completion_text: t.completion_text ?? '',
        tool_calls: t.tool_calls ?? [],
        cost_usd: t.cost_usd ?? 0,
        request_id: t.request_id ?? t.id,
        ...(t.session_id !== undefined ? { session_id: t.session_id } : {}),
        ...(t.error_message !== undefined ? { error_message: t.error_message } : {}),
      }),
    )
    .slice(0, limit);
}

// ─── Mutations: hooks + imperative ────────────────────────────────────────────

export function useCreateAgent(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => createAgent(tenant, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: agentKeys.all(tenant) });
    },
  });
}

export function useUpdateAgent(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAgentInput }) =>
      updateAgent(tenant, id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: agentKeys.all(tenant) });
    },
  });
}

export function useDeleteAgent(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAgent(tenant, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: agentKeys.all(tenant) });
    },
  });
}

export function useRotateAgentCredential(tenant: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      customFetch<DaemonRotateResponse>({
        url: `${agentBase(tenant)}/${id}/rotate-credential`,
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: agentKeys.all(tenant) });
    },
  });
}

// ─── Imperative variants (event-handler friendly) ─────────────────────────────

export async function createAgent(tenant: string, input: CreateAgentInput): Promise<AiAgent> {
  const body: Record<string, unknown> = {
    name: input.name,
    model: input.model,
    systemPrompt: input.system_prompt,
    enabled: input.enabled ?? true,
    guardrails: packGuardrails(input),
  };
  if (input.provider_id !== '') body.providerId = input.provider_id;
  if (input.description !== undefined) body.description = input.description;
  const result = await customFetch<DaemonAgent>({
    url: agentBase(tenant),
    method: 'POST',
    data: body,
  });
  return adaptAgent(result);
}

export async function updateAgent(
  tenant: string,
  id: string,
  input: UpdateAgentInput,
): Promise<AiAgent> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.model !== undefined) body.model = input.model;
  if (input.system_prompt !== undefined) body.systemPrompt = input.system_prompt;
  if (input.enabled !== undefined) body.enabled = input.enabled;
  if (input.description !== undefined) body.description = input.description;
  if (input.provider_id !== undefined) body.providerId = input.provider_id;
  // Only attach guardrails if any of its source fields are set.
  if (
    input.tool_ids !== undefined ||
    input.role_ids !== undefined ||
    input.max_tokens_per_request !== undefined ||
    input.temperature !== undefined ||
    input.stop_sequences !== undefined
  ) {
    body.guardrails = packGuardrails(input);
  }
  const result = await customFetch<DaemonAgent>({
    url: `${agentBase(tenant)}/${id}`,
    method: 'PATCH',
    data: body,
  });
  return adaptAgent(result);
}

export async function deleteAgent(tenant: string, id: string): Promise<void> {
  await customFetch<unknown>({
    url: `${agentBase(tenant)}/${id}`,
    method: 'DELETE',
  });
}

export interface RotateAgentCredentialResult {
  agentId: string;
  newCredential: string;
  prefix: string;
}

/**
 * Rotate the agent's scoped credential. The daemon returns the new credential
 * once — callers must show it to the operator and warn that it cannot be
 * recovered. Stage-2 implementation is a stub.
 */
export async function rotateScopedCredential(
  tenant: string,
  id: string,
): Promise<RotateAgentCredentialResult> {
  const res = await customFetch<DaemonRotateResponse>({
    url: `${agentBase(tenant)}/${id}/rotate-credential`,
    method: 'POST',
  });
  return {
    agentId: res.agentId ?? id,
    newCredential: res.newCredential ?? '',
    prefix: res.prefix ?? '',
  };
}

// ─── Invoke (SSE streaming) ───────────────────────────────────────────────────

export interface InvokeChunk {
  index: number;
  text: string;
}

export interface InvokeDoneSummary {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  status: 'success' | 'error' | 'timeout';
}

export interface InvokeAgentHandlers {
  onChunk: (chunk: InvokeChunk) => void;
  onDone: (summary: InvokeDoneSummary) => void;
  onError: (err: Error) => void;
}

/**
 * POST a prompt and consume the SSE stream. Resolves once the stream is
 * complete (or aborted). The returned `abort` function cancels mid-stream.
 *
 * The request body is `{prompt, variables?}` matching the daemon contract.
 */
export function invokeAgent(
  tenant: string,
  id: string,
  input: InvokeAgentInput,
  handlers: InvokeAgentHandlers,
): { promise: Promise<void>; abort: () => void } {
  const controller = new AbortController();
  const base: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';
  const url = `${base}${agentBase(tenant)}/${id}/invoke`;

  const promise = (async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({
          prompt: input.prompt,
          ...(input.session_id !== undefined ? { sessionId: input.session_id } : {}),
        }),
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      handlers.onError(cause instanceof Error ? cause : new Error('invoke network error'));
      return;
    }
    if (!res.ok) {
      handlers.onError(new Error(`invoke failed: ${String(res.status)}`));
      return;
    }
    const body = res.body;
    if (body === null) {
      handlers.onError(new Error('invoke returned empty body'));
      return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf('\n\n');
        while (sep !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          parseFrame(frame, handlers);
          sep = buffer.indexOf('\n\n');
        }
      }
      if (buffer.length > 0) parseFrame(buffer, handlers);
    } catch (cause) {
      if (controller.signal.aborted) return;
      handlers.onError(cause instanceof Error ? cause : new Error('invoke stream error'));
    }
  })();

  return {
    promise,
    abort: () => {
      controller.abort();
    },
  };
}

function parseFrame(frame: string, handlers: InvokeAgentHandlers): void {
  let event = 'message';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data += (data === '' ? '' : '\n') + line.slice(5).trimStart();
    }
  }
  if (data === '') return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    parsed = { text: data };
  }
  if (event === 'chunk') {
    const obj = parsed as Partial<InvokeChunk>;
    handlers.onChunk({
      index: typeof obj.index === 'number' ? obj.index : 0,
      text: typeof obj.text === 'string' ? obj.text : data,
    });
    return;
  }
  if (event === 'done') {
    const obj = parsed as Partial<InvokeDoneSummary>;
    handlers.onDone({
      latencyMs: obj.latencyMs ?? 0,
      inputTokens: obj.inputTokens ?? 0,
      outputTokens: obj.outputTokens ?? 0,
      costUsd: obj.costUsd ?? 0,
      status: obj.status ?? 'success',
    });
    return;
  }
  if (event === 'error') {
    const obj = parsed as { message?: string };
    handlers.onError(new Error(obj.message ?? 'invoke error'));
  }
}
