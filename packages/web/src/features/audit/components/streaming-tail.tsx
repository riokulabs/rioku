/**
 * Streaming tail (live mode) helpers for the audit list.
 *
 * Exposes:
 *   - <LiveTailBadge> — pulsing "LIVE" badge that sits in the page header
 *     whenever tail mode is active. Mirrors the Plan 3d trace-store
 *     `<LiveTailBadge>` for visual consistency; red "dot" variant signals
 *     streaming state while the gray "Paused" render is used when the
 *     switch has been toggled off but the badge is still in the tree.
 *   - useAuditStream(tenantId, enabled, onEntry) — subscribes to the
 *     `auditStreamBus` while `enabled === true` and unsubscribes cleanly
 *     on toggle-off / unmount / tenantId change.
 *
 * The store update is implicit — `publishAudit` writes to the mock store
 * through `appendAudit` inside call sites (e.g. `updateRetentionConfig`)
 * and separately dispatches on the bus. `useAuditList` re-renders via
 * Zustand subscription, so the `onEntry` callback is only needed for
 * side effects (typically bumping the "LIVE +N" counter in the header).
 */
import { useEffect } from 'react';
import { Badge } from '@mantine/core';
import { subscribeAuditStream } from '../api';
import type { AuditStreamListener } from '../types';

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
  // badge is read together rather than diffed, matching the Plan 3d
  // trace-store pattern so the two features feel identical to assistive
  // tech users.
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
 * Subscribe to the audit stream for `tenantId` while `enabled`. The
 * callback is re-bound on every render — consumers that care about
 * identity stability should wrap `onEntry` in `useCallback`. For the
 * common "increment a counter" path, re-subscribing per event is
 * negligible (single EventTarget listener swap).
 */
export function useAuditStream(
  tenantId: string,
  enabled: boolean,
  onEntry: AuditStreamListener,
): void {
  useEffect(() => {
    if (!enabled || tenantId === '') return;
    const unsub = subscribeAuditStream(tenantId, onEntry);
    return unsub;
  }, [tenantId, enabled, onEntry]);
}
