/**
 * Tests for the sessions feature (1e.94).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { useSessionList, revokeSession, revokeAllOtherSessions, parseDevice } from '../api';

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('useSessionList', () => {
  it('returns sessions for the current user', () => {
    const state = useMockStore.getState();
    const userId = state.currentUserId;
    if (!userId) throw new Error('No currentUserId');

    const { result } = renderHook(() => useSessionList(userId));
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.every((s) => s.user_id === userId)).toBe(true);
  });

  it('enriches sessions with device and location', () => {
    const state = useMockStore.getState();
    const userId = state.currentUserId;
    if (!userId) throw new Error('No currentUserId');

    const { result } = renderHook(() => useSessionList(userId));
    for (const s of result.current) {
      expect(s.device).toBeTruthy();
      expect(s.location).toBeTruthy();
      expect(s.last_seen_relative).toBeTruthy();
    }
  });

  it('filters by tenantId when provided', () => {
    const state = useMockStore.getState();
    const tenant = Object.values(state.tenants)[0];
    if (!tenant) throw new Error('No tenant');
    const userId = state.currentUserId;
    if (!userId) throw new Error('No currentUserId');

    const { result } = renderHook(() => useSessionList(userId, tenant.id));
    expect(result.current.every((s) => s.tenant_id === tenant.id)).toBe(true);
  });

  it('sorts non-revoked sessions before revoked', () => {
    const state = useMockStore.getState();
    const userId = state.currentUserId;
    if (!userId) throw new Error('No currentUserId');

    const { result } = renderHook(() => useSessionList(userId));
    const sessions = result.current;
    // Find first revoked — all non-revoked should come before it
    const firstRevokedIdx = sessions.findIndex((s) => s.revoked);
    if (firstRevokedIdx !== -1) {
      const allBefore = sessions.slice(0, firstRevokedIdx);
      expect(allBefore.every((s) => !s.revoked)).toBe(true);
    }
  });
});

describe('revokeSession', () => {
  it('marks the session as revoked', async () => {
    const state = useMockStore.getState();
    const session = Object.values(state.sessions).find((s) => !s.revoked);
    if (!session) throw new Error('No active session');

    await revokeSession(session.id);

    const updated = useMockStore.getState().sessions[session.id];
    expect(updated?.revoked).toBe(true);
    // Session still exists (not deleted)
    expect(updated).toBeDefined();
  });

  it('emits a session:revoke audit entry', async () => {
    const state = useMockStore.getState();
    const session = Object.values(state.sessions).find((s) => !s.revoked);
    if (!session) throw new Error('No active session');
    const auditBefore = state.audit.length;

    await revokeSession(session.id);

    const auditAfter = useMockStore.getState().audit;
    expect(auditAfter.length).toBeGreaterThan(auditBefore);
    const entry = auditAfter[auditAfter.length - 1];
    expect(entry?.action).toBe('session:revoke');
  });
});

describe('revokeAllOtherSessions', () => {
  it('revokes all sessions except the current one', async () => {
    const state = useMockStore.getState();
    const userId = state.currentUserId;
    if (!userId) throw new Error('No currentUserId');

    const userSessions = Object.values(state.sessions).filter(
      (s) => s.user_id === userId && !s.revoked,
    );
    if (userSessions.length < 2) {
      // If not enough sessions for this user, skip the test
      return;
    }

    const firstSession = userSessions[0];
    if (!firstSession) return;
    const keepId = firstSession.id;
    const count = await revokeAllOtherSessions(keepId);

    expect(count).toBeGreaterThan(0);

    // The kept session should NOT be revoked
    const kept = useMockStore.getState().sessions[keepId];
    expect(kept?.revoked).toBe(false);
  });

  it('emits a session:revoke-all-other audit entry', async () => {
    const state = useMockStore.getState();
    const session = Object.values(state.sessions).find((s) => !s.revoked);
    if (!session) throw new Error('No session');
    const auditBefore = state.audit.length;

    await revokeAllOtherSessions(session.id);

    const auditAfter = useMockStore.getState().audit;
    expect(auditAfter.length).toBeGreaterThan(auditBefore);
    const entry = auditAfter[auditAfter.length - 1];
    expect(entry?.action).toBe('session:revoke-all-other');
  });
});

describe('parseDevice', () => {
  it('parses Chrome correctly', () => {
    expect(parseDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120')).toBe(
      'Chrome',
    );
  });

  it('parses Firefox correctly', () => {
    expect(parseDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/121')).toBe('Firefox');
  });

  it('parses Safari correctly', () => {
    expect(parseDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604')).toBe('Safari');
  });

  it('parses rioku-cli correctly', () => {
    expect(parseDevice('rioku-cli/1.0.0')).toBe('Rioku CLI');
  });

  it('returns Unknown browser for unknown UA', () => {
    expect(parseDevice('SomeRandomAgent/1.0')).toBe('Unknown browser');
  });
});
