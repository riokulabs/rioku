/**
 * useImpersonationIdleTimer — observes the active impersonation session
 * and surfaces three pieces of UI state:
 *
 *   - `secondsRemaining` — countdown until `expires_at` in whole seconds.
 *     Negative numbers mean the session has expired but the SPA has not
 *     yet observed the daemon-side teardown.
 *   - `warning` — true once `secondsRemaining` is in the warning window
 *     (default 60s). Consumers (the modal) use this to flip visible.
 *   - `extend` — calls the daemon `POST /api/v1/admin/impersonation/{id}/touch`
 *     in real-API mode, or extends the mock-store session when in stage-1.
 *     The mutation invalidates the list query so the bridge hook picks
 *     up the new `expiresAt`.
 *
 * The timer ticks at 1 Hz while a session is live and stops when the
 * session is null. The warning threshold is the spec'd 60s but is
 * configurable so tests can tighten it.
 *
 * spec §8.2 / Task 1d.77
 */
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isRealApi } from '@/api/mode';
import { useImpersonation } from '@/hooks/use-impersonation';
import { useTouchImpersonation, getListImpersonationSessionsQueryKey } from './realApi';
import { useImpersonationSession } from './use-impersonation-session';

export interface UseImpersonationIdleTimerOptions {
  /** Show the warning when remaining time is at or below this many seconds. */
  warningThresholdSec?: number;
  /** Override `Date.now()` for tests. */
  now?: () => number;
}

export interface UseImpersonationIdleTimerResult {
  /** Whole seconds remaining until `expires_at`. Negative once expired. */
  secondsRemaining: number;
  /** True once we're inside the warning window. */
  warning: boolean;
  /** True once the wall-clock has crossed `expires_at`. */
  expired: boolean;
  /** Async — extends via daemon (real) or mock-store (stage-1). */
  extend: () => Promise<void>;
  /** Loading state for the extend call. */
  extending: boolean;
}

const DEFAULT_WARNING_SEC = 60;

export function useImpersonationIdleTimer(
  opts: UseImpersonationIdleTimerOptions = {},
): UseImpersonationIdleTimerResult {
  const warningThresholdSec = opts.warningThresholdSec ?? DEFAULT_WARNING_SEC;
  const now = opts.now ?? (() => Date.now());

  const realSession = useImpersonationSession();
  const { session: mockSession, extendSession } = useImpersonation();
  const session = realSession ?? mockSession;

  const [tick, setTick] = useState(0);

  // 1 Hz tick while a session is live.
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [session]);

  // Re-read tick to keep the effect dep (avoid the value being unused).
  void tick;

  const expiresAt = session?.expires_at ? new Date(session.expires_at).getTime() : null;
  const secondsRemaining =
    expiresAt !== null ? Math.floor((expiresAt - now()) / 1000) : Number.POSITIVE_INFINITY;
  const warning = session !== null && secondsRemaining <= warningThresholdSec;
  const expired = session !== null && secondsRemaining < 0;

  const queryClient = useQueryClient();
  const touchMutation = useTouchImpersonation();

  const extend = useCallback(async (): Promise<void> => {
    if (!session) return;
    if (isRealApi()) {
      await touchMutation.mutateAsync({ id: session.id });
      await queryClient.invalidateQueries({
        queryKey: getListImpersonationSessionsQueryKey(),
      });
      return;
    }
    await extendSession();
  }, [session, touchMutation, queryClient, extendSession]);

  return {
    secondsRemaining: secondsRemaining === Number.POSITIVE_INFINITY ? 0 : secondsRemaining,
    warning,
    expired,
    extend,
    extending: touchMutation.isPending,
  };
}
