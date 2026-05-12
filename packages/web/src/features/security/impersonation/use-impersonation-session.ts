/**
 * useImpersonationSession — bridge hook returning the currently active
 * impersonation session for the current super-admin.
 *
 * Stage-2 plan-02: reads exclusively from the daemon via the generated
 * `useListImpersonationSessions` hook and picks the first non-ended
 * session. The returned object uses the snake_case shape consumers
 * already expect (see `api/resources/impersonation.ts`); generated
 * camelCase fields are mapped on the way out.
 */

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
  const real = useListImpersonationSessions();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const sessions = (real.data?.data?.sessions ?? []) as RawGenSession[];
  const live = sessions.find((s) => !s.endedAt) ?? null;
  return live ? adaptGen(live) : null;
}
