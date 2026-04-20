/**
 * Streaming tail (live mode) helpers for the traces list.
 *
 * Exposes:
 *   - <LiveTailBadge> — pulsing "LIVE" badge that sits in the page header
 *     whenever tail mode is active. Mirrors <TailIndicator> from the audit
 *     feature for visual consistency.
 *   - useTraceStream(tenantId, enabled, onTrace) — subscribes to the mock-SSE
 *     bus while `enabled === true` and unsubscribes cleanly on toggle-off /
 *     unmount / tenantId change.
 *
 * We deliberately keep the store update implicit: `invokeAgentMock` writes
 * the trace into the mock store AND publishes on the bus, so `useTraceList`
 * re-renders by Zustand subscription. The onTrace callback fired here is
 * used purely for side effects — typically bumping a "LIVE +N" counter in
 * the page header.
 */
import { useEffect } from 'react';
import { Badge } from '@mantine/core';
import { subscribeTraceStream } from '../api';
import type { TraceStreamListener } from '../types';

interface LiveTailBadgeProps {
  liveCount: number;
}

export function LiveTailBadge({ liveCount }: LiveTailBadgeProps) {
  return (
    <>
      <style>{LIVE_PULSE_KEYFRAMES}</style>
      <Badge
        color="teal"
        variant="dot"
        size="sm"
        data-testid="trace-live-badge"
        style={{
          animation: 'rioku-live-pulse 1.6s infinite ease-in-out',
        }}
      >
        LIVE{liveCount > 0 ? ` +${String(liveCount)}` : ''}
      </Badge>
    </>
  );
}

/** Keyframes registered inline so we don't have to touch global CSS. The name
 *  is prefixed with `rioku-` to avoid clashes with Mantine or plugin CSS. */
const LIVE_PULSE_KEYFRAMES = `@keyframes rioku-live-pulse {
  0%   { opacity: 1; }
  50%  { opacity: 0.55; }
  100% { opacity: 1; }
}`;

/**
 * Subscribe to the trace stream for `tenantId` while `enabled`. The callback
 * is re-bound on every render — consumers should wrap it in `useCallback` if
 * identity stability matters, but for the common "increment a counter" path
 * the cost of re-subscribing on each trace event is negligible (single
 * EventTarget listener swap).
 */
export function useTraceStream(
  tenantId: string,
  enabled: boolean,
  onTrace: TraceStreamListener,
): void {
  useEffect(() => {
    if (!enabled || tenantId === '') return;
    const unsub = subscribeTraceStream(tenantId, onTrace);
    return unsub;
    // We intentionally re-subscribe when onTrace changes — callers that want
    // to avoid this should memoize the callback.
  }, [tenantId, enabled, onTrace]);
}
