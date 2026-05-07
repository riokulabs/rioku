/**
 * useImpersonation — thin client-side wrapper around the daemon's
 * super-admin impersonation surface.
 *
 * Stage-2: the daemon owns the session lifecycle, audit log emission,
 * scope construction, and wall-clock expiry. The SPA only:
 *   - mirrors the active session id into the local active-impersonation
 *     cell (so the mutator can stamp `X-Impersonation-Id`);
 *   - surfaces the canonical session via the daemon-backed bridge hook
 *     `useImpersonationSession`;
 *   - exposes thin `entry` / `exit` / `extendSession` helpers that
 *     dispatch the corresponding mutations and invalidate the list
 *     query so consumers re-render.
 *
 * Returns:
 *   - `state`     — derived 'idle' | 'active' (transient 'entering' /
 *                   'exiting' states are reported while the underlying
 *                   mutation is in flight).
 *   - `session`   — daemon-reported session, or null when none.
 *   - `entry`     — POST /admin/impersonation.
 *   - `exit`      — DELETE /admin/impersonation/:id.
 *   - `extendSession` — POST /admin/impersonation/:id/touch.
 */

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setActiveImpersonationId } from '../api/active-impersonation';
import {
  useStartImpersonation,
  useEndImpersonation,
  useTouchImpersonation,
  getListImpersonationSessionsQueryKey,
} from '../features/security/impersonation/realApi';
import { useImpersonationSession } from '../features/security/impersonation/use-impersonation-session';
import type { ImpersonationSession } from '../api/resources';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImpersonationState = 'idle' | 'entering' | 'active' | 'exiting';

export type TierName = 'read' | 'read-sensitive' | 'write' | 'destructive';

export interface ImpersonationEntryOpts {
  tenant_id: string;
  user_id?: string;
  reason: string;
  ticketRef?: string;
  /**
   * Stage-1 TOTP mock — retained for callers that still pass a code, but
   * the actual TOTP step-up is handled by the daemon via the auth flow
   * before the entry mutation runs. Validated client-side as 6 digits to
   * preserve the legacy entry-form contract.
   */
  totpCode: string;
  /** minimal = super-admin's full perms. full = read-only + opt-in tiers. */
  profile: 'minimal' | 'full';
  /** Only relevant when profile === 'full'. Opt-in write/destructive tiers. */
  additionalScope?: TierName[];
}

export interface UseImpersonationReturn {
  state: ImpersonationState;
  session: ImpersonationSession | null;
  entry: (opts: ImpersonationEntryOpts) => Promise<void>;
  exit: () => Promise<void>;
  extendSession: () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useImpersonation(): UseImpersonationReturn {
  const session = useImpersonationSession();
  const queryClient = useQueryClient();
  const startMutation = useStartImpersonation();
  const endMutation = useEndImpersonation();
  const touchMutation = useTouchImpersonation();

  const state: ImpersonationState = startMutation.isPending
    ? 'entering'
    : endMutation.isPending
      ? 'exiting'
      : session
        ? 'active'
        : 'idle';

  const entry = useCallback(
    async (opts: ImpersonationEntryOpts): Promise<void> => {
      // Preserve the stage-1 client-side TOTP shape check; the daemon
      // does the authoritative verification.
      if (!/^\d{6}$/.test(opts.totpCode)) {
        throw new Error('Invalid TOTP code — must be 6 digits');
      }

      const res = await startMutation.mutateAsync({
        data: {
          tenantId: opts.tenant_id,
          targetUserId: opts.user_id ?? '',
          reason: opts.reason,
          ...(opts.ticketRef ? { ticketRef: opts.ticketRef } : {}),
        },
      });

      const newId = (res.data as { id?: string } | undefined)?.id ?? null;
      if (newId) {
        setActiveImpersonationId(newId);
      }

      await queryClient.invalidateQueries({
        queryKey: getListImpersonationSessionsQueryKey(),
      });
    },
    [startMutation, queryClient],
  );

  const exit = useCallback(async (): Promise<void> => {
    if (!session) {
      setActiveImpersonationId(null);
      return;
    }
    try {
      await endMutation.mutateAsync({ id: session.id });
    } finally {
      setActiveImpersonationId(null);
      await queryClient.invalidateQueries({
        queryKey: getListImpersonationSessionsQueryKey(),
      });
    }
  }, [session, endMutation, queryClient]);

  const extendSession = useCallback(async (): Promise<void> => {
    if (!session) return;
    await touchMutation.mutateAsync({ id: session.id });
    await queryClient.invalidateQueries({
      queryKey: getListImpersonationSessionsQueryKey(),
    });
  }, [session, touchMutation, queryClient]);

  return { state, session, entry, exit, extendSession };
}
