/**
 * AI Traces API — daemon-backed read-only surface + SSE live tail + CSV export.
 *
 * Stage-2 (Plan 04 / 13): traces are owned by the daemon at
 * `/api/v1/t/{tenant}/ai/traces/...`. This module exposes:
 *
 *   - `useTraceList(tenantSlug, filter)` — TanStack Query against the Orval
 *     `useListAITraces` hook. Server filters (`status`) are pushed through
 *     when exactly one is selected; multi-status / agent / search filtering
 *     is done client-side on the returned slice. The daemon shape is
 *     adapted into the legacy snake-case `AiTrace` shape consumed by stage-1
 *     UI components, so the existing list/detail/CSV code keeps working.
 *
 *   - `useTraceDetail(tenantSlug, traceId)` — daemon GET-by-id; returns the
 *     adapted snake-case trace.
 *
 *   - `subscribeTraceStream(tenantSlug, onTrace)` — opens an `EventSource`
 *     against `/api/v1/events?topic=ai-traces&tenant={tenantSlug}` and
 *     fires `onTrace` for every JSON event landing on the multiplexed
 *     channel. Returns an unsubscribe.
 *
 *   - `revealTrace(tenantSlug, traceId, reason)` — POSTs to
 *     `/api/v1/t/{tenant}/ai/traces/{id}/reveal` with `{ reason }` and
 *     returns the unmasked trace. Audited daemon-side.
 *
 *   - `exportTracesCsv(tenantSlug, filter)` — POSTs
 *     `/api/v1/t/{tenant}/ai/traces/export?format=csv[&status=...]` and
 *     streams the response body via `getReader()` into a single Blob. Throws
 *     when the daemon returns non-2xx. Falls back to `arrayBuffer()` when
 *     the response has a null body (synthesised test responses).
 */
import { useMemo } from 'react';
import { useListAITraces, useGetAITrace } from '@/api/generated/ai-traces/ai-traces';
import type { AITrace, ListAITracesParams } from '@/api/generated/schemas';
import type { AiTrace } from '@/api/resources';
import type { TraceFilter, TraceStreamListener } from './types';

// ─── Daemon → legacy shape adapter ────────────────────────────────────────────

function parseJsonObject(v: unknown): Record<string, unknown> {
  if (typeof v !== 'string' || v === '') return {};
  try {
    const out = JSON.parse(v) as unknown;
    return out !== null && typeof out === 'object' ? (out as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseJsonValue(v: unknown): unknown {
  if (typeof v !== 'string' || v === '') return null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
}

function adaptTrace(d: AITrace): AiTrace {
  // Map camelCase daemon fields to the snake-case shape expected by the stage-1
  // UI components. `request_id` is synthesised from the trace id when the
  // daemon doesn't surface a separate column.
  return {
    id: d.id,
    tenant_id: d.tenantId,
    agent_id: (d.agentId ?? ''),
    provider_id: (d.providerId ?? ''),
    model: d.model,
    status: d.status as AiTrace['status'],
    input_tokens: d.inputTokens,
    output_tokens: d.outputTokens,
    latency_ms: d.durationMs,
    cost_usd: 0,
    request_id: d.id,
    at: d.occurredAt,
    prompt_text: d.prompt ?? '',
    completion_text: d.completion ?? '',
    tool_calls: (d.toolCalls ?? []).map((tc) => {
      const t = tc as Record<string, unknown>;
      return {
        tool_id: (t.toolId as string | undefined) ?? '',
        tool_name: (t.name as string | undefined) ?? '',
        arguments: parseJsonObject(t.argsJson),
        result: parseJsonValue(t.resultJson),
        latency_ms: (t.durationMs as number | undefined) ?? 0,
        status: ((t.status as string | undefined) ??
          'success') as AiTrace['tool_calls'][number]['status'],
        ...(typeof t.error === 'string' ? { error_message: t.error } : {}),
      };
    }),
    error_message: d.error ?? '',
  };
}

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * Daemon-backed trace list for `tenantSlug` filtered by `filter`. The hook
 * returns the array directly (not a query result) to preserve the stage-1
 * call-site contract: `const rows = useTraceList(tenant, filter)`.
 */
export function useTraceList(tenantSlug: string, filter: TraceFilter): AiTrace[] {
  const firstStatus = filter.statuses[0];
  const params: ListAITracesParams | undefined =
    filter.statuses.length === 1 && firstStatus !== undefined ? { status: firstStatus } : undefined;

  const { data } = useListAITraces(tenantSlug, params);

  return useMemo(() => {
    const items: AITrace[] = data?.data.items ?? [];
    const rows = items.map(adaptTrace);
    const search = filter.search.trim().toLowerCase();
    return rows
      .filter((t) => {
        if (filter.agent_ids.length > 0 && !filter.agent_ids.includes(t.agent_id)) return false;
        if (filter.statuses.length > 0 && !filter.statuses.includes(t.status)) return false;
        if (filter.since && t.at < filter.since) return false;
        if (filter.until && t.at >= filter.until) return false;
        if (search) {
          const promptMatch = t.prompt_text.toLowerCase().includes(search);
          const completionMatch = t.completion_text.toLowerCase().includes(search);
          if (!promptMatch && !completionMatch) return false;
        }
        return true;
      })
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [data, filter]);
}

/** Daemon-backed detail result with explicit loading + missing states. */
export interface TraceDetailResult {
  trace: AiTrace | undefined;
  isLoading: boolean;
  isMissing: boolean;
}

/** Daemon-backed detail; returns the adapted snake-case trace, or `undefined`. */
export function useTraceDetail(tenantSlug: string, traceId: string): TraceDetailResult {
  const { data, isLoading, isError } = useGetAITrace(tenantSlug, traceId);
  const raw: AITrace | undefined = (data as { data?: AITrace } | undefined)?.data;
  const trace = useMemo(() => (raw ? adaptTrace(raw) : undefined), [raw]);
  return {
    trace,
    isLoading,
    isMissing: isError && !isLoading,
  };
}

// ─── SSE live tail ────────────────────────────────────────────────────────────

/**
 * Subscribe to the per-tenant trace stream over the multiplexed
 * `/api/v1/events?topic=ai-traces&tenant=<slug>` SSE channel. Each `message`
 * event payload is JSON-encoded; we parse and adapt to the legacy shape
 * before invoking `onTrace`.
 */
export function subscribeTraceStream(
  tenantSlug: string,
  onTrace: TraceStreamListener,
): () => void {
  const url = `/api/v1/events?topic=ai-traces&tenant=${encodeURIComponent(tenantSlug)}`;
  const es = new EventSource(url, { withCredentials: true });

  const handler = (ev: MessageEvent<string>): void => {
    try {
      const parsed = JSON.parse(ev.data) as AITrace;
      onTrace(adaptTrace(parsed));
    } catch {
      // Drop malformed payloads — daemon contract is JSON-only on this channel.
    }
  };

  es.addEventListener('message', handler as (ev: Event) => void);

  return () => {
    es.removeEventListener('message', handler as (ev: Event) => void);
    es.close();
  };
}

// ─── Reveal ───────────────────────────────────────────────────────────────────

/**
 * Reveal sensitive prompt + completion for a trace. Audited daemon-side; the
 * caller must supply a free-text justification ≥ 10 chars (UI enforced).
 */
export async function revealTrace(
  tenantSlug: string,
  traceId: string,
  reason: string,
): Promise<AiTrace> {
  const url = `/api/v1/t/${tenantSlug}/ai/traces/${traceId}/reveal`;
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    throw new Error(`Trace reveal failed: ${String(res.status)} ${res.statusText}`);
  }
  const body = (await res.json()) as AITrace;
  return adaptTrace(body);
}

// ─── CSV export ───────────────────────────────────────────────────────────────

/**
 * POST `/ai/traces/export?format=csv[&status=...]` and assemble the streamed
 * response body into a single Blob. Throws on non-2xx.
 */
export async function exportTracesCsv(tenantSlug: string, filter: TraceFilter): Promise<Blob> {
  const params = new URLSearchParams();
  params.set('format', 'csv');
  if (filter.statuses.length === 1) {
    params.set('status', filter.statuses[0] ?? '');
  }
  const url = `/api/v1/t/${tenantSlug}/ai/traces/export?${params.toString()}`;

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentIds: filter.agent_ids,
      statuses: filter.statuses,
      search: filter.search,
      since: filter.since ?? null,
      until: filter.until ?? null,
    }),
  });

  if (!res.ok) {
    throw new Error(`CSV export failed: ${String(res.status)} ${res.statusText}`);
  }

  const mime = res.headers.get('content-type') ?? 'text/csv;charset=utf-8';

  // Streaming reader path (preferred): assemble chunks as the daemon emits
  // them. Falls back to arrayBuffer() when the synthesised test response has
  // no readable body.
  if (res.body) {
    const reader = res.body.getReader();
    const parts: BlobPart[] = [];
    let done = false;
    while (!done) {
      const chunk = await reader.read();
      done = chunk.done;
      if (chunk.value !== undefined) {
        // Copy into a fresh ArrayBuffer-backed view so the Blob constructor's
        // `BlobPart` constraint (ArrayBuffer, not SharedArrayBuffer) is satisfied
        // under TypeScript 5.5+ stricter typings.
        parts.push(new Uint8Array(chunk.value).buffer);
      }
    }
    return new Blob(parts, { type: mime });
  }

  const buf = await res.arrayBuffer();
  return new Blob([buf], { type: mime });
}
