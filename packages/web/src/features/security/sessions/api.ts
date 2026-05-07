/**
 * Sessions API — backed by the Orval-generated daemon hooks.
 *
 * Public function names (`useSessionList`, `useSessionMutations`,
 * `revokeSession`, `revokeAllOtherSessions`, `parseDevice`) are
 * preserved across the legacy and real-API surfaces so existing
 * consumers continue to compile.
 *
 * RD5: sessions are inline-only — no drawer, no full-page detail.
 * The list page renders rows with device fingerprint + IP +
 * last-active inline + per-row Revoke + page-level Revoke-all-others.
 */
import { useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListSessions,
  useRevokeSession as useRevokeSessionGenerated,
  useRevokeOtherSessions as useRevokeOtherSessionsGenerated,
  revokeSession as revokeSessionRequest,
  revokeOtherSessions as revokeOtherSessionsRequest,
  getListSessionsQueryKey,
} from '@/api/generated/sessions/sessions';
import type { ListSessions200SessionsItem } from '@/api/generated/schemas';
import type { SessionWithMeta } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a coarse device fingerprint from a user-agent string. The result is
 * intentionally readable (e.g. "Chrome", "Rioku CLI") rather than verbose;
 * the IP column carries the discriminator when two devices share an UA.
 */
export function parseDevice(ua: string): string {
  if (!ua) return 'Unknown device';
  if (ua.includes('rioku-cli')) return 'Rioku CLI';
  if (ua.includes('curl')) return 'curl';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
  if (ua.includes('Chrome')) return 'Chrome';
  return 'Unknown browser';
}

function relativeTime(isoStr: string | undefined): string {
  if (!isoStr) return '—';
  const t = new Date(isoStr).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${String(hrs)}h ago`;
  const days = Math.floor(hrs / 24);
  return `${String(days)}d ago`;
}

function enrichSession(
  raw: ListSessions200SessionsItem,
  currentSessionId: string | null,
): SessionWithMeta {
  const id = raw.id ?? '';
  const userAgent = raw.userAgent ?? '';
  return {
    id,
    user_id: raw.userId ?? '',
    tenant_id: raw.tenantId ?? '',
    ip: raw.ipAddress ?? '',
    user_agent: userAgent,
    last_seen: raw.lastActivityAt ?? '',
    expires_at: raw.expiresAt ?? '',
    revoked: raw.revoked ?? false,
    device: parseDevice(userAgent),
    location: '',
    last_seen_relative: relativeTime(raw.lastActivityAt),
    is_current: currentSessionId !== null && id === currentSessionId,
  };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

interface UseSessionListResult {
  sessions: SessionWithMeta[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * Returns the active sessions for the current principal in the given tenant.
 *
 * The current-session id is resolved per-call (defaults to `null` — the
 * daemon does not yet expose a "this session" hint over the list endpoint;
 * callers can pass an explicit id once the bridge lands).
 *
 * The hook accepts optional `currentSessionId` so callers (the inline list
 * page, tests) can mark the appropriate row.
 */
export function useSessionList(
  tenant: string,
  currentSessionId: string | null = null,
): UseSessionListResult {
  const query = useListSessions(tenant);
  const data = query.data?.data;

  const sessions = useMemo<SessionWithMeta[]>(() => {
    const raw = data?.sessions ?? [];
    const enriched = raw.map((s) => enrichSession(s, currentSessionId));
    return enriched.sort((a, b) => {
      if (a.revoked !== b.revoked) return a.revoked ? 1 : -1;
      return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
    });
  }, [data, currentSessionId]);

  return {
    sessions,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Hook bundle for revocation mutations. Returns imperative async helpers
 * that close over the active tenant and invalidate the list query on
 * success so the inline page re-renders without manual refetch wiring.
 */
export function useSessionMutations(tenant: string) {
  const queryClient = useQueryClient();
  const revokeMutation = useRevokeSessionGenerated();
  const revokeOthersMutation = useRevokeOtherSessionsGenerated();

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey(tenant) });
  }, [queryClient, tenant]);

  const revokeSession = useCallback(
    async (sessionId: string): Promise<void> => {
      await revokeMutation.mutateAsync({ tenant, id: sessionId });
      invalidate();
    },
    [revokeMutation, tenant, invalidate],
  );

  const revokeAllOtherSessions = useCallback(async (): Promise<void> => {
    await revokeOthersMutation.mutateAsync({ tenant });
    invalidate();
  }, [revokeOthersMutation, tenant, invalidate]);

  return {
    revokeSession,
    revokeAllOtherSessions,
    isRevokingSession: revokeMutation.isPending,
    isRevokingOthers: revokeOthersMutation.isPending,
  };
}

/**
 * Imperative revoke — issues the DELETE directly against the daemon.
 * Preserved for callers that operate outside the React tree (e.g.
 * `users/components/detail.tsx` which still drives revocation against
 * the mock store via its own `revokeSession`; this export is the
 * real-API counterpart should that ever flip).
 */
export async function revokeSession(tenant: string, sessionId: string): Promise<void> {
  await revokeSessionRequest(tenant, sessionId);
}

/**
 * Imperative revoke-all-others — issues POST .../sessions/revoke-others.
 * The daemon decides which session is "current" from the request
 * credentials, so no id is passed.
 */
export async function revokeAllOtherSessions(tenant: string): Promise<void> {
  await revokeOtherSessionsRequest(tenant);
}
