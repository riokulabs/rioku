/**
 * Host event bus — spec §9.5.9
 *
 * Wraps `mockBus` (src/api/mock-sse.ts) so plugins can subscribe to and
 * emit typed host events without needing private mock-store access.
 *
 * Standard topics (documented here; plugins must use these exact strings):
 *   service:created    service:updated    service:deleted
 *   route:created      route:updated      route:deleted
 *   user:created       user:updated       user:disabled
 *   tenant:created     tenant:updated
 *   plugin:enabled     plugin:disabled
 *   policy:saved       policy:deleted
 *   audit:new
 *
 * First-party code calls `emitHostEvent` to publish.
 * Plugins subscribe via `subscribeHostEvent` (returned unsub fn) or the React
 * hook `useHostEventSubscription`.
 */

import { useEffect } from 'react';
import { mockBus, publishMock } from '@/api/mock-sse';

// ─── Subscribe / emit ─────────────────────────────────────────────────────────

/**
 * Subscribe to a typed host event.
 * Returns an unsubscribe function — call it to remove the listener.
 *
 * @param topic   - The event topic string (e.g. "service:created").
 * @param handler - Callback receiving the typed payload.
 */
// The generic overloads below are intentional: the type parameter ties the
// `data` / `handler` argument types together at the call site.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function subscribeHostEvent<T>(topic: string, handler: (data: T) => void): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<T>).detail);
  };
  mockBus.addEventListener(topic, listener);
  return () => {
    mockBus.removeEventListener(topic, listener);
  };
}

/**
 * Emit a host event. Intended for first-party code only.
 * Plugins consume events via the subscribe/hook surface.
 *
 * @param topic - The event topic string.
 * @param data  - The event payload.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function emitHostEvent<T>(topic: string, data: T): void {
  publishMock(topic, data);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * React hook — subscribes to a host event on mount, unsubscribes on unmount.
 * Safe to use in multiple components; each call gets its own listener.
 *
 * @param topic   - The event topic string.
 * @param handler - Stable callback reference (use `useCallback` if needed).
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function useHostEventSubscription<T>(topic: string, handler: (data: T) => void): void {
  useEffect(() => {
    const unsub = subscribeHostEvent<T>(topic, handler);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);
}
