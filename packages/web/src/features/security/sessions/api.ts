/**
 * Sessions API — backed by the Zustand mock store.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { logAuditEntry } from '@/api/resources/audit';
import type { Session } from '@/api/resources/types';
import type { SessionWithMeta } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentActorId(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function getCurrentTenantId(): string {
  return useMockStore.getState().currentTenantId ?? '';
}

/** Parse a device name from a user-agent string (no external dep). */
export function parseDevice(ua: string): string {
  if (ua.includes('rioku-cli')) return 'Rioku CLI';
  if (ua.includes('curl')) return 'curl';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
  if (ua.includes('Chrome')) return 'Chrome';
  return 'Unknown browser';
}

/** Stub geo-location derived from IP octets for stage-1. */
function geoFromIp(ip: string): string {
  const locations = [
    'Toronto, CA',
    'San Francisco, US',
    'London, UK',
    'Berlin, DE',
    'Sydney, AU',
    'Tokyo, JP',
    'Paris, FR',
    'New York, US',
    'Amsterdam, NL',
    'Singapore, SG',
  ];
  const parts = ip.split('.');
  const lastOctet = parseInt(parts[parts.length - 1] ?? '0', 10);
  return locations[lastOctet % locations.length] ?? 'Unknown';
}

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${String(hrs)}h ago`;
  const days = Math.floor(hrs / 24);
  return `${String(days)}d ago`;
}

function enrichSession(
  session: Session,
  currentSessionId: string | null,
): SessionWithMeta {
  return {
    ...session,
    device: parseDevice(session.user_agent),
    location: geoFromIp(session.ip),
    last_seen_relative: relativeTime(session.last_seen),
    is_current: session.id === currentSessionId,
  };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * Returns sessions for the given userId (defaults to currentUserId).
 * If tenantId is provided, filters to that tenant.
 */
export function useSessionList(userId?: string, tenantId?: string): SessionWithMeta[] {
  const allSessions = useMockStore((s) => s.sessions);
  const currentUserId = useMockStore((s) => s.currentUserId);
  const activeImpersonationId = useMockStore((s) => s.activeImpersonationId);

  const targetUserId = userId ?? currentUserId;
  if (!targetUserId) return [];

  // For stage-1, the "current session" is the first non-revoked session for this user
  // In a real app this would come from the auth token.
  const currentSessionId = activeImpersonationId ?? null;

  const results: SessionWithMeta[] = [];
  for (const session of Object.values(allSessions)) {
    if (session.user_id !== targetUserId) continue;
    if (tenantId && session.tenant_id !== tenantId) continue;
    results.push(enrichSession(session, currentSessionId));
  }

  // Sort: non-revoked first, then by last_seen descending
  return results.sort((a, b) => {
    if (a.revoked !== b.revoked) return a.revoked ? 1 : -1;
    return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useSessionMutations() {
  return { revokeSession, revokeAllOtherSessions };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  state.updateEntity('sessions', sessionId, { revoked: true });

  logAuditEntry({
    tenant_id: getCurrentTenantId(),
    actor_id: getCurrentActorId(),
    action: 'session:revoke',
    resource_type: 'session',
    resource_id: sessionId,
    tier: 'destructive',
  });
}

export async function revokeAllOtherSessions(currentSessionId: string): Promise<number> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const currentUserId = state.currentUserId;
  const tenantId = getCurrentTenantId();

  let count = 0;
  for (const session of Object.values(state.sessions)) {
    if (session.id === currentSessionId) continue;
    if (session.user_id !== currentUserId) continue;
    if (session.revoked) continue;
    state.updateEntity('sessions', session.id, { revoked: true });
    count++;
  }

  logAuditEntry({
    tenant_id: tenantId,
    actor_id: currentUserId ?? 'unknown',
    action: 'session:revoke-all-other',
    resource_type: 'session',
    tier: 'destructive',
    payload: { count, kept_session_id: currentSessionId },
  });

  return count;
}
