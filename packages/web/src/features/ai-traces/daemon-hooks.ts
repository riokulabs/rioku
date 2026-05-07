/**
 * AI Traces — daemon-backed hooks (T7 wiring).
 *
 * Re-exports Orval-generated hooks for `/api/v1/t/{tenant}/ai/traces/...`.
 *
 * Notes:
 * - Sensitive fields (`prompt`, `completion`) are returned by the daemon for
 *   GET-by-id only and require the `ai-trace:read-sensitive` permission.
 *   Daemon issue #117 tracks fine-grained gating; UI redacts based on
 *   `usePermission('ai-trace:read-sensitive')` as a defence-in-depth guard.
 * - Live SSE tail uses `subscribeAITraceStream` below — wraps the multiplexed
 *   `/api/v1/events?topic=ai-traces` channel; for per-tenant tail the daemon's
 *   `/api/v1/t/{tenant}/ai/traces/stream` is used directly via EventSource.
 * - CSV export uses `getExportAITracesCSVUrl` to build a download link.
 */
export {
  useListAITraces as useTraceList,
  useGetAITrace as useTraceDetail,
  // Imperative variants
  listAITraces,
  getAITrace,
  exportAITracesCSV,
  getExportAITracesCSVUrl,
  streamAITraces,
  getStreamAITracesUrl,
} from '@/api/generated/ai-traces/ai-traces';

export type { AITrace } from '@/api/generated/schemas';

/**
 * Subscribe to the per-tenant AI trace SSE stream. Each event is JSON-encoded;
 * payload shape matches `AITrace`'s public fields (no `prompt`/`completion`).
 *
 * Returns an unsubscribe function. Auto-reconnects on transient errors with
 * exponential backoff capped at 30s.
 */
export function subscribeAITraceStream(
  tenant: string,
  onEvent: (trace: unknown) => void,
): () => void {
  const url = `/api/v1/t/${tenant}/ai/traces/stream`;
  let closed = false;
  let backoffMs = 1000;
  let es: EventSource | null = null;

  const open = (): void => {
    es = new EventSource(url, { withCredentials: true });
    es.addEventListener('message', (ev: MessageEvent<string>) => {
      backoffMs = 1000;
      try {
        onEvent(JSON.parse(ev.data) as unknown);
      } catch {
        onEvent(ev.data);
      }
    });
    es.addEventListener('ai-trace', (ev: MessageEvent<string>) => {
      backoffMs = 1000;
      try {
        onEvent(JSON.parse(ev.data) as unknown);
      } catch {
        onEvent(ev.data);
      }
    });
    es.addEventListener('error', () => {
      if (closed) return;
      es?.close();
      const jitter = backoffMs * (0.8 + Math.random() * 0.4);
      setTimeout(() => {
        if (!closed) open();
      }, jitter);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    });
  };
  open();

  return () => {
    closed = true;
    es?.close();
  };
}
