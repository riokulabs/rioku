/**
 * useImpersonationSession — bridge hook returning the currently active
 * impersonation session for the current super-admin.
 *
 * In stage-1 mock mode this reads from the Zustand mock store (the
 * existing source of truth for `<ImpersonationBanner>`). In stage-2 real
 * mode (`VITE_USE_MOCKS=false`), it reads the daemon via the generated
 * `useListImpersonationSessions` hook and picks the first non-ended
 * session belonging to the current actor.
 *
 * The returned object uses the snake_case shape consumers already
 * expect (see `api/resources/impersonation.ts`); generated camelCase
 * fields are mapped on the way out.
 */

import { useMockStore } from '@/api/mock-store';
import { isRealApi } from '@/api/mode';
import type { ImpersonationSession } from '@/api/resources';
import { useListImpersonationSessions } from './realApi';

interface RawGenSession {
  id?: string;
  actorUserId?: string;
  targetUserId?: string;
  tenantId?: string;
  reason?: string;
  ticketRef?: string;
  startedAt?: string;
  endedAt?: string;
  expiresAt?: string;
}

function adaptGen(session: RawGenSession): ImpersonationSession {
  return {
    id: session.id ?? '',
    super_admin_id: session.actorUserId ?? '',
    tenant_id: session.tenantId ?? '',
    ...(session.targetUserId ? { user_id: session.targetUserId } : {}),
    reason: session.reason ?? '',
    ...(session.ticketRef ? { ticketRef: session.ticketRef } : {}),
    started_at: session.startedAt ?? '',
    expires_at: session.expiresAt ?? '',
    scope: [],
  };
}

export function useImpersonationSession(): ImpersonationSession | null {
  // Always invoke both hooks to keep React's hooks order stable.
  const realEnabled = isRealApi();
  const real = useListImpersonationSessions({
    query: { enabled: realEnabled },
  });
  const activeId = useMockStore((s) => s.activeImpersonationId);
  const mockSession = useMockStore((s) =>
    activeId ? (s.impersonationSessions[activeId] ?? null) : null,
  );

  if (realEnabled) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const sessions = (real.data?.data?.sessions ?? []) as RawGenSession[];
    const live = sessions.find((s) => !s.endedAt) ?? null;
    return live ? adaptGen(live) : null;
  }
  return mockSession;
}
