/**
 * Streaming tail (live mode) helpers for the audit list.
 *
 * Exposes:
 *   - <LiveTailBadge> — pulsing "LIVE" badge for the page header.
 *   - useAuditStream(tenantId, enabled, onEntry) — subscribes to the SSE
 *     stream at `/api/v1/t/:tenant/audit/stream` while `enabled === true`.
 *     Preserves Last-Event-ID across pauses so reconnect replays missed
 *     entries. The callback fires per `AuditEntry` and is used for UI
 *     side effects only (the page's query handles cache invalidation).
 */
import { useEffect, useRef } from 'react';
import { Badge } from '@mantine/core';
import { subscribeSSE } from '@/api/sse-client';
import type { AuditEntry } from '@/api/resources';
import type { AuditStreamListener } from '../types';

/** SSE topic for the tenant-scoped audit stream. */
function auditStreamTopic(tenantId: string): string {
  return `t/${tenantId}/audit`;
}

interface LiveTailBadgeProps {
  /** Count of audit entries received since the tail was enabled. */
  newCount: number;
  /**
   * When `false`, render a muted "Paused" badge instead of the pulsing
   * LIVE indicator. Callers typically unmount the badge entirely when
   * paused, but the branch is here so the component is safe either way.
   */
  isLive: boolean;
}

export function LiveTailBadge({ newCount, isLive }: LiveTailBadgeProps) {
  // role="status" + aria-live="polite" announces the "+N" counter to
  // screen readers when new entries land. aria-atomic ensures the whole
  // badge is read together rather than diffed.
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      <style>{LIVE_PULSE_KEYFRAMES}</style>
      <Badge
        color={isLive ? 'red' : 'gray'}
        variant="dot"
        size="sm"
        data-testid="audit-live-badge"
        style={
          isLive ? { animation: 'rioku-audit-live-pulse 1.6s infinite ease-in-out' } : undefined
        }
      >
        {isLive ? `LIVE${newCount > 0 ? ` +${String(newCount)}` : ''}` : 'Paused'}
      </Badge>
    </div>
  );
}

/** Keyframes registered inline so we don't have to touch global CSS. The
 *  name is prefixed with `rioku-audit-` to avoid clashes with the trace
 *  feature's keyframe block or any plugin CSS. */
const LIVE_PULSE_KEYFRAMES = `@keyframes rioku-audit-live-pulse {
  0%   { opacity: 1; }
  50%  { opacity: 0.55; }
  100% { opacity: 1; }
}`;

/**
 * Subscribe to the real SSE audit stream for `tenantId` while `enabled`.
 *
 * Connects to `/api/v1/events?topic=t/<tenantId>/audit` via `subscribeSSE`.
 * The SSE client handles Last-Event-ID resumption automatically, so pausing
 * and re-enabling preserves the connection's replay cursor.
 *
 * `onEntry` fires for every `AuditEntry` payload received. Callers should
 * wrap it in `useCallback` if they need a stable reference.
 */
export function useAuditStream(
  tenantId: string,
  enabled: boolean,
  onEntry: AuditStreamListener,
): void {
  // Keep a stable ref to onEntry so the subscribeSSE handler always calls
  // the latest version without needing to re-subscribe on every render.
  const onEntryRef = useRef(onEntry);
  useEffect(() => {
    onEntryRef.current = onEntry;
  }, [onEntry]);

  useEffect(() => {
    if (!enabled || tenantId === '') return;
    const topic = auditStreamTopic(tenantId);
    const unsub = subscribeSSE(topic, (detail) => {
      // The SSE client JSON-parses the event data; cast to AuditEntry.
      if (detail !== null && typeof detail === 'object') {
        onEntryRef.current(detail as AuditEntry);
      }
    });
    return unsub;
  }, [tenantId, enabled]);
}
