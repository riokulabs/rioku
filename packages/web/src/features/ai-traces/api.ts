/**
 * AI Traces API — read-only surface + streaming tail + CSV export.
 *
 * Traces are produced by `invokeAgentMock` (features/ai-agents/api.ts) which
 * writes them to the store AND publishes them on `traceStreamBus`. This
 * module exposes list/detail selectors for historical traces plus a thin
 * subscribe wrapper over the bus for live-tail UIs.
 *
 * CSV export is returned as a `Blob` so callers can decide how to deliver
 * it (download link, FileSystemAccessAPI, test assertion, etc.).
 */
import { useMockStore } from '@/api/mock-store';
import {
  TRACE_STREAM_TOPIC,
  traceStreamBus,
} from '@/api/trace-stream-bus';
import type { AiTrace } from '@/api/resources/types';
import type { TraceFilter, TraceStreamListener } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchesFilter(trace: AiTrace, tenantId: string, filter: TraceFilter): boolean {
  if (trace.tenant_id !== tenantId) return false;
  if (filter.agent_ids.length > 0 && !filter.agent_ids.includes(trace.agent_id))
    return false;
  if (filter.statuses.length > 0 && !filter.statuses.includes(trace.status))
    return false;
  if (filter.since && trace.at < filter.since) return false;
  if (filter.until && trace.at >= filter.until) return false;
  const search = filter.search.trim().toLowerCase();
  if (search) {
    const promptMatch = trace.prompt_text.toLowerCase().includes(search);
    const completionMatch = trace.completion_text.toLowerCase().includes(search);
    if (!promptMatch && !completionMatch) return false;
  }
  return true;
}

/** CSV-escape a cell per RFC 4180 — wrap in quotes when it contains special chars. */
function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * All traces for `tenantId` that match the filter, sorted desc by `at`.
 *
 * Zustand selector body only grabs the raw record — filter + sort happens
 * outside the selector so the hook identity is stable across renders that
 * don't actually touch the filtered output.
 */
export function useTraceList(
  tenantId: string,
  filter: TraceFilter,
): AiTrace[] {
  const traces = useMockStore((s) => s.aiTraces);
  const out: AiTrace[] = [];
  for (const t of Object.values(traces)) {
    if (matchesFilter(t, tenantId, filter)) out.push(t);
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out;
}

export function useTraceDetail(id: string): AiTrace | undefined {
  return useMockStore((s) => s.aiTraces[id]);
}

// ─── Stream subscription ─────────────────────────────────────────────────────

/**
 * Subscribe to newly-emitted traces for a given tenant. Invokes `onTrace` for
 * every `publishTrace` call where `trace.tenant_id === tenantId`. Returns an
 * unsubscribe function.
 */
export function subscribeTraceStream(
  tenantId: string,
  onTrace: TraceStreamListener,
): () => void {
  const handler = (e: Event): void => {
    const detail = (e as CustomEvent<AiTrace>).detail;
    if (detail.tenant_id !== tenantId) return;
    onTrace(detail);
  };
  traceStreamBus.addEventListener(TRACE_STREAM_TOPIC, handler);
  return () => {
    traceStreamBus.removeEventListener(TRACE_STREAM_TOPIC, handler);
  };
}

// ─── Export ──────────────────────────────────────────────────────────────────

const CSV_HEADER =
  'at,request_id,agent_name,model,status,input_tokens,output_tokens,latency_ms,cost_usd';

/**
 * Build a CSV blob from traces matching `filter`, for the given tenant.
 *
 * Columns (RFC 4180-escaped):
 *   at,request_id,agent_name,model,status,input_tokens,output_tokens,latency_ms,cost_usd
 *
 * Rows are sorted desc by `at` to mirror the list view. The caller is
 * responsible for triggering the download (e.g. via a synthetic `<a download>`).
 */
export function exportTracesCsv(
  tenantId: string,
  filter: TraceFilter,
): Blob {
  const state = useMockStore.getState();
  const rows: string[] = [CSV_HEADER];
  const matched: AiTrace[] = [];
  for (const t of Object.values(state.aiTraces)) {
    if (matchesFilter(t, tenantId, filter)) matched.push(t);
  }
  matched.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  for (const t of matched) {
    const agent = state.aiAgents[t.agent_id];
    const agentName = agent?.name ?? t.agent_id;
    rows.push(
      [
        csvEscape(t.at),
        csvEscape(t.request_id),
        csvEscape(agentName),
        csvEscape(t.model),
        csvEscape(t.status),
        csvEscape(t.input_tokens),
        csvEscape(t.output_tokens),
        csvEscape(t.latency_ms),
        csvEscape(t.cost_usd),
      ].join(','),
    );
  }

  return new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
}
