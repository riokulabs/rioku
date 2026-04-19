/**
 * useSubscription — subscribe to a named event topic.
 *
 * Stage 1: delegates to the in-memory `mockBus` EventTarget.
 * Stage 2+: swap the implementation to open a real EventSource against
 *   /api/v1/events?topic=<topic> and call handler on each `message` event.
 *   The hook signature stays identical so call sites need no changes.
 *
 * The handler ref pattern avoids re-subscribing on every render when the
 * consumer passes an inline function. Only `topic` changes trigger a new
 * subscription.
 */
import { useEffect, useRef } from 'react';
import { mockBus } from '@/api/mock-sse';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function useSubscription<T = unknown>(
  topic: string,
  handler: (detail: T) => void,
): void {
  // Always keep a ref to the latest handler — the effect below never needs
  // to re-run just because handler changed (avoids subscribe/unsubscribe churn).
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const listener = (event: Event) => {
      handlerRef.current((event as CustomEvent<T>).detail);
    };
    mockBus.addEventListener(topic, listener);
    return () => {
      mockBus.removeEventListener(topic, listener);
    };
  }, [topic]); // re-subscribe only when topic changes
}
