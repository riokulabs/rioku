/**
 * Shared fetchers — SSE helper + optimistic-update utilities.
 *
 * Stage 1: `subscribeSSE` delegates to the in-memory mockBus.
 * Stage 2+: open a real EventSource against /api/v1/events?topic=<topic>.
 */

import { mockBus } from './mock-sse';

// ─── SSE helper ───────────────────────────────────────────────────────────────

/**
 * Subscribe to a server-sent event topic.
 *
 * Returns a cleanup function; call it to unsubscribe.
 *
 * Stage 1: backed by in-memory EventTarget.
 * Stage 2+: backed by a real EventSource.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function subscribeSSE<T = unknown>(
  topic: string,
  handler: (detail: T) => void,
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<T>).detail);
  };
  mockBus.addEventListener(topic, listener);
  return () => {
    mockBus.removeEventListener(topic, listener);
  };
}

// ─── Optimistic rollback ──────────────────────────────────────────────────────

/**
 * Snapshot of a previous value to restore on mutation failure.
 *
 * Usage:
 *   const rollback = snapshot(previousItems);
 *   // if mutation fails: rollback.restore(queryClient, queryKey);
 */
export interface OptimisticRollback<T> {
  /** The captured previous value. */
  previous: T;
  /**
   * Restore the previous value into the TanStack Query cache.
   * Accepts a `setQueryData`-compatible setter so this module stays
   * decoupled from the QueryClient import (avoids circular deps).
   */
  restore(setQueryData: (data: T) => void): void;
}

export function snapshot<T>(previous: T): OptimisticRollback<T> {
  return {
    previous,
    restore(setQueryData) {
      setQueryData(previous);
    },
  };
}
