/**
 * MSW handlers for AI Agents feature tests.
 *
 * Provides an in-memory backend matching the daemon's `/api/v1/t/{tenant}/ai/
 * agents` surface. Tests reset the store via `resetAgentStore` and seed via
 * `makeAgent` overrides.
 */
import { http, HttpResponse } from 'msw';

interface DaemonAgent {
  id: string;
  tenantId: string;
  providerId: string | null;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  guardrails: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const BASE = '*/api/v1';

let agentStore: Record<string, DaemonAgent> = {};
let idCounter = 1;

function nextId(): string {
  const id = `aiagent-${String(idCounter)}`;
  idCounter += 1;
  return id;
}

export function resetAgentStore(seed?: DaemonAgent[]): void {
  agentStore = {};
  idCounter = 1;
  if (seed) {
    for (const a of seed) agentStore[a.id] = a;
  }
}

export function makeAgent(overrides: Partial<DaemonAgent> = {}): DaemonAgent {
  const id = overrides.id ?? nextId();
  const now = new Date().toISOString();
  return {
    id,
    tenantId: overrides.tenantId ?? 'tenant-acme',
    providerId: overrides.providerId ?? 'aiprov-1',
    name: overrides.name ?? `Agent ${id}`,
    description: overrides.description ?? '',
    model: overrides.model ?? 'gpt-4o',
    systemPrompt: overrides.systemPrompt ?? 'You are helpful.',
    guardrails: overrides.guardrails ?? {
      toolIds: [],
      roleIds: [],
      maxTokensPerRequest: 4096,
      temperature: 0.7,
      stopSequences: [],
    },
    enabled: overrides.enabled ?? true,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

export const aiAgentHandlers = [
  http.get(`${BASE}/t/:tenant/ai/agents`, () => {
    const items = Object.values(agentStore);
    return HttpResponse.json({ items, total: items.length });
  }),
  http.get(`${BASE}/t/:tenant/ai/agents/:id`, ({ params }) => {
    const a = agentStore[params.id as string];
    if (!a) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(a);
  }),
  http.post(`${BASE}/t/:tenant/ai/agents`, async ({ request, params }) => {
    const body = (await request.json()) as Partial<DaemonAgent>;
    const id = nextId();
    const now = new Date().toISOString();
    const a: DaemonAgent = {
      id,
      tenantId: `tenant-${params.tenant as string}`,
      providerId: body.providerId ?? null,
      name: body.name ?? 'unnamed',
      description: body.description ?? '',
      model: body.model ?? 'gpt-4o',
      systemPrompt: body.systemPrompt ?? '',
      guardrails: body.guardrails ?? {},
      enabled: body.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    agentStore[id] = a;
    return HttpResponse.json(a, { status: 201 });
  }),
  http.patch(`${BASE}/t/:tenant/ai/agents/:id`, async ({ params, request }) => {
    const id = params.id as string;
    const existing = agentStore[id];
    if (!existing) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as Partial<DaemonAgent>;
    const next: DaemonAgent = {
      ...existing,
      ...body,
      updatedAt: new Date().toISOString(),
    };
    agentStore[id] = next;
    return HttpResponse.json(next);
  }),
  http.put(`${BASE}/t/:tenant/ai/agents/:id`, async ({ params, request }) => {
    const id = params.id as string;
    const existing = agentStore[id];
    if (!existing) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as Partial<DaemonAgent>;
    const next: DaemonAgent = {
      ...existing,
      ...body,
      id,
      updatedAt: new Date().toISOString(),
    };
    agentStore[id] = next;
    return HttpResponse.json(next);
  }),
  http.delete(`${BASE}/t/:tenant/ai/agents/:id`, ({ params }) => {
    const id = params.id as string;
    if (!agentStore[id]) return new HttpResponse(null, { status: 404 });
    const { [id]: _gone, ...rest } = agentStore;
    void _gone;
    agentStore = rest;
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(`${BASE}/t/:tenant/ai/agents/:id/tools`, ({ params }) => {
    const id = params.id as string;
    if (!agentStore[id]) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({
      items: [
        { id: 'b1', toolId: 'tool-a', agentId: id, enabled: true },
        { id: 'b2', toolId: 'tool-b', agentId: id, enabled: true },
      ],
      total: 2,
    });
  }),
  http.get(`${BASE}/t/:tenant/ai/agents/:id/traces`, ({ params }) => {
    const id = params.id as string;
    if (!agentStore[id]) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({
      items: [
        {
          id: 'trace-1',
          tenantId: agentStore[id].tenantId,
          agentId: id,
          providerId: agentStore[id].providerId,
          model: agentStore[id].model,
          input_tokens: 100,
          output_tokens: 50,
          latency_ms: 250,
          status: 'success',
          at: new Date().toISOString(),
          prompt_text: 'hello',
          completion_text: 'hi',
          tool_calls: [],
          cost_usd: 0.001,
          request_id: 'req_test_1',
        },
      ],
      total: 1,
    });
  }),
  http.post(`${BASE}/t/:tenant/ai/agents/:id/rotate-credential`, ({ params }) => {
    const id = params.id as string;
    if (!agentStore[id]) return new HttpResponse(null, { status: 404 });
    const cred = `sk-rot-${id}-${String(Date.now())}`;
    return HttpResponse.json({
      agentId: id,
      ok: true,
      newCredential: cred,
      prefix: cred.slice(0, 12),
    });
  }),
  // Invoke — returns SSE stream with a couple of chunks + done frame.
  http.post(`${BASE}/t/:tenant/ai/agents/:id/invoke`, async ({ params, request }) => {
    const id = params.id as string;
    if (!agentStore[id]) return new HttpResponse(null, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { prompt?: string };
    if (typeof body.prompt !== 'string' || body.prompt === '') {
      return HttpResponse.json({ message: 'prompt required' }, { status: 400 });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(`event: chunk\ndata: ${JSON.stringify({ index: 0, text: 'Hello ' })}\n\n`),
        );
        controller.enqueue(
          encoder.encode(`event: chunk\ndata: ${JSON.stringify({ index: 1, text: 'world.' })}\n\n`),
        );
        controller.enqueue(
          encoder.encode(
            `event: done\ndata: ${JSON.stringify({
              latencyMs: 42,
              inputTokens: 5,
              outputTokens: 2,
              costUsd: 0.0001,
              status: 'success',
            })}\n\n`,
          ),
        );
        controller.close();
      },
    });
    return new HttpResponse(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }),
];

/** Variant: invoke handler that returns a 500 to test error handling. */
export const invokeErrorHandler = http.post(`${BASE}/t/:tenant/ai/agents/:id/invoke`, () =>
  HttpResponse.json({ message: 'upstream blew up' }, { status: 500 }),
);

/** Variant: invoke handler that streams chunks slowly so abort can fire. */
export const invokeSlowHandler = http.post(`${BASE}/t/:tenant/ai/agents/:id/invoke`, () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(`event: chunk\ndata: ${JSON.stringify({ index: 0, text: 'first ' })}\n\n`),
      );
      // Never close — caller must abort.
    },
    cancel() {
      // ReadableStream cancel hook fires when the consumer aborts.
    },
  });
  return new HttpResponse(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
});
