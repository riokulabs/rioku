/**
 * AI Agents API — backed by the Zustand mock store.
 *
 * Mirrors features/services/api.ts:
 *   - selectors pull raw Records, derive outside the selector body
 *   - mutations call simulateLatency + appendAudit + emitHostEvent
 *
 * `invokeAgentMock` synthesises a realistic `AiTrace`, writes it to the store,
 * and publishes it onto `traceStreamBus` so the live-tail consumer sees the
 * new trace in real time.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import { publishTrace } from '@/api/trace-stream-bus';
import type {
  AiAgent,
  AiTool,
  AiTrace,
  AiTraceToolCall,
  AuditEntry,
} from '@/api/resources/types';
import type {
  AgentFilter,
  CreateAgentInput,
  InvokeAgentInput,
  UpdateAgentInput,
} from './types';

const nextAgentId = makeIdFactory('aiagent-new');
const nextTraceId = makeIdFactory('aitrace-invoke');
const nextAuditId = makeIdFactory('audit-aiagent');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function getCurrentActorId(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function makeAuditEntry(
  actorId: string,
  tenantId: string | null,
  action: string,
  resourceId?: string,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  return {
    id: nextAuditId(),
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    resource_type: 'ai-agent',
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier,
  };
}

function credentialPrefix(raw: string): string {
  return raw.slice(0, Math.min(12, raw.length));
}

/** djb2 hash over a string — deterministic, never negative. */
function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useAgentList(
  tenantId: string,
  filter: AgentFilter,
): AiAgent[] {
  const agents = useMockStore((s) => s.aiAgents);
  const search = filter.search.toLowerCase().trim();
  const results: AiAgent[] = [];
  for (const agent of Object.values(agents)) {
    if (agent.tenant_id !== tenantId) continue;
    if (filter.provider_ids.length > 0 && !filter.provider_ids.includes(agent.provider_id)) continue;
    if (filter.enabled !== undefined && agent.enabled !== filter.enabled) continue;
    if (filter.role_ids.length > 0) {
      if (!filter.role_ids.some((rid) => agent.role_ids.includes(rid))) continue;
    }
    if (search) {
      const nameMatch = agent.name.toLowerCase().includes(search);
      const descMatch = agent.description?.toLowerCase().includes(search) ?? false;
      const modelMatch = agent.model.toLowerCase().includes(search);
      if (!nameMatch && !descMatch && !modelMatch) continue;
    }
    results.push(agent);
  }
  return results;
}

export function useAgentDetail(id: string): AiAgent | undefined {
  return useMockStore((s) => s.aiAgents[id]);
}

/**
 * Tools accessible to the agent — bindings take precedence over `tool_ids`.
 * If any binding exists for the agent, only bound (enabled) tools are returned.
 * If no bindings exist, the agent.tool_ids list is used directly.
 */
export function useAgentTools(id: string): AiTool[] {
  const agents = useMockStore((s) => s.aiAgents);
  const tools = useMockStore((s) => s.aiTools);
  const bindings = useMockStore((s) => s.aiToolBindings);

  const agent = agents[id];
  if (!agent) return [];

  const bindingsForAgent = Object.values(bindings).filter(
    (b) => b.agent_id === id,
  );
  if (bindingsForAgent.length > 0) {
    const out: AiTool[] = [];
    for (const b of bindingsForAgent) {
      if (!b.enabled) continue;
      const t = tools[b.tool_id];
      if (t) out.push(t);
    }
    return out;
  }
  const out: AiTool[] = [];
  for (const tid of agent.tool_ids) {
    const t = tools[tid];
    if (t) out.push(t);
  }
  return out;
}

/** Recent traces for an agent — sorted desc by `at`, limited. */
export function useAgentTraces(id: string, limit = 20): AiTrace[] {
  const traces = useMockStore((s) => s.aiTraces);
  const out: AiTrace[] = [];
  for (const t of Object.values(traces)) {
    if (t.agent_id === id) out.push(t);
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out.slice(0, limit);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createAgent(
  tenantId: string,
  input: CreateAgentInput,
): Promise<AiAgent> {
  await simulateLatency('mutation');

  const id = nextAgentId();
  const agent: AiAgent = {
    id,
    tenant_id: tenantId,
    name: input.name,
    provider_id: input.provider_id,
    model: input.model,
    system_prompt: input.system_prompt,
    tool_ids: [...input.tool_ids],
    enabled: input.enabled ?? true,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.scoped_credential !== undefined
      ? {
          scoped_credential_ref: {
            prefix: credentialPrefix(input.scoped_credential),
            created_at: now(),
          },
        }
      : {}),
    role_ids: [...input.role_ids],
    max_tokens_per_request: input.max_tokens_per_request,
    temperature: input.temperature,
    stop_sequences: [...input.stop_sequences],
    created_at: now(),
    updated_at: now(),
  };

  const state = useMockStore.getState();
  state.addEntity('aiAgents', agent);
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), tenantId, 'ai-agent.create', id),
  );
  emitHostEvent('ai-agent.created', { agent_id: id, tenant_id: tenantId });
  return agent;
}

export async function updateAgent(
  id: string,
  input: UpdateAgentInput,
): Promise<AiAgent> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const current = state.aiAgents[id];
  if (!current) throw new Error(`Agent ${id} not found`);

  const patch: Partial<AiAgent> = { updated_at: now() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.provider_id !== undefined) patch.provider_id = input.provider_id;
  if (input.model !== undefined) patch.model = input.model;
  if (input.system_prompt !== undefined) patch.system_prompt = input.system_prompt;
  if (input.tool_ids !== undefined) patch.tool_ids = [...input.tool_ids];
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.description !== undefined) patch.description = input.description;
  if (input.role_ids !== undefined) patch.role_ids = [...input.role_ids];
  if (input.max_tokens_per_request !== undefined)
    patch.max_tokens_per_request = input.max_tokens_per_request;
  if (input.temperature !== undefined) patch.temperature = input.temperature;
  if (input.stop_sequences !== undefined)
    patch.stop_sequences = [...input.stop_sequences];

  const before = { ...current };
  state.updateEntity('aiAgents', id, patch);
  const updated = useMockStore.getState().aiAgents[id];
  if (!updated) throw new Error(`Agent ${id} vanished mid-update`);

  state.appendAudit({
    ...makeAuditEntry(
      getCurrentActorId(),
      current.tenant_id,
      'ai-agent.update',
      id,
    ),
    diff: { before, after: updated },
  });
  emitHostEvent('ai-agent.updated', {
    agent_id: id,
    tenant_id: current.tenant_id,
  });
  return updated;
}

export async function deleteAgent(id: string): Promise<void> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const agent = state.aiAgents[id];
  if (!agent) throw new Error(`Agent ${id} not found`);

  // Clean up any bindings that reference this agent — atomic multi-entity.
  const bindingsToRemove = Object.values(state.aiToolBindings)
    .filter((b) => b.agent_id === id)
    .map((b) => b.id);

  useMockStore.setState((s) => {
    const nextAgents = { ...s.aiAgents };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete nextAgents[id];
    const nextBindings = { ...s.aiToolBindings };
    for (const bid of bindingsToRemove) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete nextBindings[bid];
    }
    return { aiAgents: nextAgents, aiToolBindings: nextBindings };
  });

  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      agent.tenant_id,
      'ai-agent.delete',
      id,
      'destructive',
    ),
  );
  emitHostEvent('ai-agent.deleted', {
    agent_id: id,
    tenant_id: agent.tenant_id,
    cascaded_binding_count: bindingsToRemove.length,
  });
}

export async function rotateScopedCredential(
  agentId: string,
  newCredential: string,
): Promise<AiAgent> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.aiAgents[agentId];
  if (!current) throw new Error(`Agent ${agentId} not found`);

  const ref = {
    prefix: credentialPrefix(newCredential),
    created_at: now(),
  };
  state.updateEntity('aiAgents', agentId, {
    scoped_credential_ref: ref,
    updated_at: now(),
  });

  const updated = useMockStore.getState().aiAgents[agentId];
  if (!updated) throw new Error(`Agent ${agentId} vanished`);

  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      current.tenant_id,
      'ai-agent.rotate-credential',
      agentId,
    ),
  );
  emitHostEvent('ai-agent.credential-rotated', {
    agent_id: agentId,
    prefix: ref.prefix,
  });
  return updated;
}

// ─── Invoke (mock) ───────────────────────────────────────────────────────────

/**
 * Rotating pool of realistic-looking completion templates. One of these is
 * picked (deterministically, by prompt hash) for every invoke call so repeated
 * test runs produce stable snapshots.
 */
const COMPLETION_TEMPLATES: string[] = [
  'Based on the provided context, the answer is: the endpoint at /v1/services returns paginated Service objects keyed by tenant.',
  "Here's a step-by-step breakdown:\n1. Start by ensuring the gateway is reachable.\n2. Authenticate with a valid API key.\n3. Retry the request with `--trace` to capture the upstream response.",
  'The code snippet you referenced performs request normalisation; it strips trailing slashes and lowercases the host header before matching.',
  "I'd recommend the following approach: split the route into two — one that proxies the read path and another that handles the write path with stricter validation.",
  "That's a great question. The key insight is that Caddy's admin API exposes config diffs, so you can check the delta before applying it.",
  'Looking at the trace you shared, the latency budget is consumed mostly by the upstream DNS lookup; caching it via CoreDNS would help.',
  'If you need to debug this further, attach the gateway logs and filter by the request_id — each hop logs under the same id.',
  'Consider setting a stricter timeout at the service level and letting the middleware fall back to the default when the upstream is slow.',
  'The spec calls for an idempotency key on POST — your request is missing one. Add `Idempotency-Key` to the headers list.',
  "In this scenario, you'd want to configure a circuit-breaker middleware with a 5-request rolling window and a 30-second cool-off.",
  'You can reproduce the issue locally by running the sandbox with the failure-injection flag enabled. See the sandbox Makefile target.',
  'For long-running requests, stream the response with SSE rather than holding the connection open — the client can resume on disconnect.',
  "The pattern here is known as 'fanout': one inbound request dispatches to several upstreams and aggregates responses.",
  'Remember that the tenant_id is encoded in the JWT; if it is missing the gateway should reject the request with 401.',
  'A good sanity check is to run the policy through the CEL parser without evaluating it — syntax errors are easier to spot that way.',
  'The metric you mentioned is derived from the traces table; each trace contributes tokens_used to a rolling aggregate per agent.',
  'This behaviour is intentional — the semantic rate-limiter deliberately down-samples identical-similarity requests to protect upstreams.',
  'You can hot-reload middlewares without restarting the daemon; config changes propagate through the watcher within ~1 second.',
  'Double-check that the MCP server URL includes the `/tools` suffix — otherwise the server returns 404 before the auth header is read.',
  'The recommended configuration is to bind the agent to a scoped credential, then rotate it at least once per quarter.',
];

/** Latency distribution for invoke: mostly fast, occasional long tail. */
function pickLatency(h: number): number {
  const bucket = h % 10;
  if (bucket === 0) return 2_500 + (h % 500); // slow tail
  if (bucket < 3) return 800 + (h % 400);
  return 200 + (h % 300);
}

/** Cost per 1K tokens — deterministic per model-hash. */
function costFor(model: string, input: number, output: number): number {
  const seed = hashCode(model);
  const per1k = 0.001 + (seed % 40) / 10_000; // $0.001 – $0.005
  return Number((((input + output) / 1000) * per1k).toFixed(4));
}

function pickTemplate(h: number): string {
  const idx = h % COMPLETION_TEMPLATES.length;
  return COMPLETION_TEMPLATES[idx] ?? COMPLETION_TEMPLATES[0] ?? '';
}

/**
 * Synthesise a realistic trace for `agentId` + `prompt`, write it to the store,
 * emit audit + host event, and publish on the trace-stream bus.
 */
export async function invokeAgentMock(
  agentId: string,
  input: InvokeAgentInput,
): Promise<AiTrace> {
  const state = useMockStore.getState();
  const agent = state.aiAgents[agentId];
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  // Deterministic values are keyed on prompt+agent so repeated same-input calls
  // produce the same shape — useful for tests.
  const h = hashCode(`${agentId}|${input.prompt}|${String(Date.now() >>> 10)}`);
  const latency = pickLatency(h);

  await new Promise<void>((resolve) => setTimeout(resolve, Math.min(latency, 100)));

  const inputTokens = 60 + (h % 480);
  const outputTokens = 40 + (h % 240);
  const status: AiTrace['status'] = (h % 25 === 0)
    ? 'error'
    : (h % 37 === 0)
      ? 'timeout'
      : 'success';

  // Build tool-call list — ~30% of invocations include 1-2 tool calls when
  // the agent has any tools bound.
  const availableTools = agent.tool_ids;
  const toolCalls: AiTraceToolCall[] = [];
  if (availableTools.length > 0 && h % 10 < 3) {
    const count = 1 + ((h >> 8) % 2);
    for (let i = 0; i < count; i++) {
      const tid = availableTools[(h + i) % availableTools.length];
      if (tid === undefined) continue;
      const tool = state.aiTools[tid];
      if (!tool) continue;
      toolCalls.push({
        tool_id: tid,
        tool_name: tool.name,
        arguments: { query: input.prompt.slice(0, 40), hint: `mock-${String(i)}` },
        result: { ok: true, summary: `mock result for ${tool.name}` },
        latency_ms: 40 + ((h >> (4 * (i + 1))) & 0xff),
        status: 'success',
      });
    }
  }

  const requestId = `req_${h.toString(16).padStart(8, '0')}`;
  const traceId = nextTraceId();
  const trace: AiTrace = {
    id: traceId,
    tenant_id: agent.tenant_id,
    agent_id: agentId,
    provider_id: agent.provider_id,
    model: agent.model,
    ...(input.session_id !== undefined ? { session_id: input.session_id } : {}),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    latency_ms: latency,
    status,
    at: now(),
    prompt_text: input.prompt,
    completion_text:
      status === 'error'
        ? ''
        : pickTemplate(h),
    tool_calls: toolCalls,
    cost_usd: costFor(agent.model, inputTokens, outputTokens),
    ...(status === 'error'
      ? { error_message: 'mock: upstream returned 503' }
      : status === 'timeout'
        ? { error_message: 'mock: request exceeded 30s deadline' }
        : {}),
    request_id: requestId,
  };

  state.addEntity('aiTraces', trace);
  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      agent.tenant_id,
      'ai-agent.invoke',
      agentId,
    ),
  );
  emitHostEvent('ai-agent.invoked', {
    agent_id: agentId,
    tenant_id: agent.tenant_id,
    trace_id: traceId,
    request_id: requestId,
    status,
  });
  publishTrace(trace);
  return trace;
}
