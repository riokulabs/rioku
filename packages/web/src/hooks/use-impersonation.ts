/**
 * useImpersonation — state machine for super-admin tenant impersonation.
 *
 * States:
 *   idle      → no active session
 *   entering  → TOTP validated, writing session to store
 *   active    → session live, timers running
 *   exiting   → clearing session + emitting exit audit
 *
 * Timers (active state only):
 *   - Idle timer: 60 minutes of no keyboard/mouse activity → exit()
 *   - Wall-clock timer: checked every minute → exit() if wall_clock_expires_at passed
 *
 * Two-sided audit:
 *   - `logAdminAuditEntry` → super-admin cross-tenant hash-chained log
 *   - `logAuditEntry`      → tenant-side log (with acted_as_admin: true)
 *   Both carry `impersonation_session_id` for grouping.
 *
 * Stage-1 TOTP mock: any 6-digit numeric string is accepted. Real TOTP lands in 1e.
 *
 * spec §8.2 / Task 1d.74
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useMockStore } from '../api/mock-store';
import { makeIdFactory } from '../lib/id-generator';
import { logAuditEntry, logAdminAuditEntry } from '../api/resources/audit';
import type { ImpersonationSession } from '../api/resources/types';

// ─── ID factory ───────────────────────────────────────────────────────────────

const nextImpId = makeIdFactory('imp');

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImpersonationState = 'idle' | 'entering' | 'active' | 'exiting';

export type TierName =
  | 'read'
  | 'read-sensitive'
  | 'write'
  | 'destructive';

export interface ImpersonationEntryOpts {
  tenant_id: string;
  user_id?: string;
  reason: string;
  ticketRef?: string;
  totpCode: string;
  /** minimal = super-admin's full perms. full = read-only + optional write tiers */
  profile: 'minimal' | 'full';
  /** Only relevant when profile === 'full'. Opt-in write/destructive tiers. */
  additionalScope?: TierName[];
}

export interface UseImpersonationReturn {
  state: ImpersonationState;
  session: ImpersonationSession | null;
  entry: (opts: ImpersonationEntryOpts) => Promise<void>;
  exit: () => Promise<void>;
  extendSession: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS = 60 * 60 * 1000;       // 60 minutes
const WALL_CLOCK_MS = 4 * 60 * 60 * 1000;     // 4 hours
const WALL_CLOCK_CHECK_INTERVAL_MS = 60_000;   // check every minute

// ─── Scope builders ───────────────────────────────────────────────────────────

function buildMinimalScope(superAdminId: string): string[] {
  // Minimal: super-admin's full permissions in that tenant.
  // Stage-1: derive from the admin role's grants — represented as a broad set.
  const state = useMockStore.getState();
  const memberships = Object.values(state.memberships).filter(
    (m) => m.user_id === superAdminId && m.state === 'active',
  );
  const roleIds = memberships.flatMap((m) => m.role_ids);
  const roles = state.roles;
  const perms = new Set<string>();
  for (const rid of roleIds) {
    const role = roles[rid];
    if (role) {
      for (const grant of role.grants) {
        perms.add(grant.permission);
      }
    }
  }
  return Array.from(perms);
}

function buildFullScope(additionalScope: TierName[] = []): string[] {
  // Full profile: read-only by default, opt-in to write/destructive tiers.
  const base: string[] = [
    'user:read',
    'role:read',
    'service:read',
    'route:read',
    'policy:read',
    'api-key:read',
    'session:read',
    'audit:read',
    'tenant:switch',
  ];
  const tierMap: Record<TierName, string[]> = {
    read: [],
    'read-sensitive': ['user:read', 'audit:read'],
    write: ['service:write', 'route:write', 'policy:write', 'role:write', 'user:invite'],
    destructive: ['service:delete', 'route:delete', 'policy:delete', 'role:delete', 'api-key:delete', 'session:revoke'],
  };
  const extra = new Set<string>();
  for (const tier of additionalScope) {
    for (const p of tierMap[tier]) {
      extra.add(p);
    }
  }
  return Array.from(new Set([...base, ...extra]));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useImpersonation(): UseImpersonationReturn {
  // Session lives in mock-store (activeImpersonationId + impersonationSessions map)
  // so all components (entry form, banner, etc.) see the same state.
  const activeId = useMockStore((s) => s.activeImpersonationId);
  const session = useMockStore((s) => (activeId ? (s.impersonationSessions[activeId] ?? null) : null));
  // Transient 'entering' flag is set for a single tick during entry() before
  // the store commit. Derive the stable states from session presence.
  const [transient, setTransient] = useState<'entering' | null>(null);
  const state: ImpersonationState = transient ?? (session ? 'active' : 'idle');
  const setState = useCallback((next: ImpersonationState) => {
    setTransient(next === 'entering' ? 'entering' : null);
  }, []);

  // Idle timer — reset on any activity
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Wall-clock interval
  const wallClockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Stable ref to exit so effect callbacks don't need re-registration
  const exitRef = useRef<(() => Promise<void>) | null>(null);

  // ── exit ─────────────────────────────────────────────────────────────────

  const exit = useCallback((): Promise<void> => {
    const sessionSnapshot = session;
    if (!sessionSnapshot) {
      setState('idle');
      return Promise.resolve();
    }

    // Compute duration
    const startedAt = new Date(sessionSnapshot.started_at).getTime();
    const durationMs = Date.now() - startedAt;

    const exitPayload = {
      session_id: sessionSnapshot.id,
      reason: sessionSnapshot.reason,
      duration_ms: durationMs,
    };

    // Clear active session id + remove from store
    useMockStore.setState({ activeImpersonationId: null });
    useMockStore.getState().deleteEntity('impersonationSessions', sessionSnapshot.id);
    setState('idle');

    // Emit tenant-side audit entry (sync)
    logAuditEntry({
      tenant_id: sessionSnapshot.tenant_id,
      actor_id: sessionSnapshot.super_admin_id,
      action: 'impersonation:exit',
      resource_type: 'impersonation_session',
      resource_id: sessionSnapshot.id,
      impersonation_session_id: sessionSnapshot.id,
      acted_as_admin: true,
      tier: 'write',
      payload: exitPayload,
    });

    // Emit admin-side audit entry (async hash chain)
    return logAdminAuditEntry({
      tenant_id: null,
      actor_id: sessionSnapshot.super_admin_id,
      action: 'impersonation:exit',
      resource_type: 'impersonation_session',
      resource_id: sessionSnapshot.id,
      impersonation_session_id: sessionSnapshot.id,
      tier: 'write',
      payload: exitPayload,
    });
  }, [session, setState]);

  // Keep exitRef stable
  useEffect(() => {
    exitRef.current = exit;
  }, [exit]);

  // ── Idle timer management ─────────────────────────────────────────────────

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      const exitFn = exitRef.current;
      if (exitFn) void exitFn();
    }, IDLE_TIMEOUT_MS);
  }, []);

  // ── extendSession ─────────────────────────────────────────────────────────

  const extendSession = useCallback(() => {
    const current = session;
    if (!current) return;
    const newExpiry = new Date(Date.now() + IDLE_TIMEOUT_MS).toISOString();
    useMockStore.getState().updateEntity('impersonationSessions', current.id, {
      expires_at: newExpiry,
    });
    resetIdleTimer();
  }, [session, resetIdleTimer]);

  // ── entry ─────────────────────────────────────────────────────────────────

  const entry = useCallback(
    async (opts: ImpersonationEntryOpts): Promise<void> => {
      // Validate TOTP — stage-1: any 6-digit numeric string
      if (!/^\d{6}$/.test(opts.totpCode)) {
        throw new Error('Invalid TOTP code — must be 6 digits');
      }

      setState('entering');

      const state = useMockStore.getState();
      const superAdminId = state.currentUserId;
      if (!superAdminId) {
        setState('idle');
        throw new Error('No authenticated user');
      }

      const now = Date.now();
      const sessionId = nextImpId();

      const scope =
        opts.profile === 'minimal'
          ? buildMinimalScope(superAdminId)
          : buildFullScope(opts.additionalScope);

      const newSession: ImpersonationSession = {
        id: sessionId,
        super_admin_id: superAdminId,
        tenant_id: opts.tenant_id,
        ...(opts.user_id ? { user_id: opts.user_id } : {}),
        reason: opts.reason,
        ...(opts.ticketRef ? { ticketRef: opts.ticketRef } : {}),
        started_at: new Date(now).toISOString(),
        expires_at: new Date(now + IDLE_TIMEOUT_MS).toISOString(),
        scope,
      };

      // Write to mock-store
      useMockStore.getState().addEntity('impersonationSessions', newSession);

      // Two-sided audit — admin log
      await logAdminAuditEntry({
        tenant_id: null,
        actor_id: superAdminId,
        action: 'impersonation:enter',
        resource_type: 'impersonation_session',
        resource_id: sessionId,
        impersonation_session_id: sessionId,
        tier: 'write',
        payload: {
          session_id: sessionId,
          target_tenant_id: opts.tenant_id,
          target_user_id: opts.user_id,
          reason: opts.reason,
          ticketRef: opts.ticketRef,
          profile: opts.profile,
          scope,
        },
      });

      // Two-sided audit — tenant log
      logAuditEntry({
        tenant_id: opts.tenant_id,
        actor_id: superAdminId,
        action: 'impersonation:enter',
        resource_type: 'impersonation_session',
        resource_id: sessionId,
        impersonation_session_id: sessionId,
        acted_as_admin: true,
        tier: 'write',
        payload: {
          session_id: sessionId,
          reason: opts.reason,
          ticketRef: opts.ticketRef,
          profile: opts.profile,
        },
      });

      // Mark this session as the active one — banner + other consumers
      // derive the live session from activeImpersonationId + the sessions map.
      useMockStore.setState({ activeImpersonationId: sessionId });
      setState('active');
    },
    [setState],
  );

  // ── Timers — active state ─────────────────────────────────────────────────

  useEffect(() => {
    if (state !== 'active') {
      // Clear timers when not active
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (wallClockRef.current) clearInterval(wallClockRef.current);
      return;
    }

    // Start idle timer
    resetIdleTimer();

    // Activity listeners — reset idle timer on any input
    function onActivity() {
      resetIdleTimer();
    }
    document.addEventListener('mousemove', onActivity);
    document.addEventListener('keydown', onActivity);
    document.addEventListener('mousedown', onActivity);
    document.addEventListener('touchstart', onActivity);

    // Wall-clock interval — read session from store each tick so we always
    // see the current value without closing over stale state.
    wallClockRef.current = setInterval(() => {
      const activeIdNow = useMockStore.getState().activeImpersonationId;
      if (!activeIdNow) return;
      const current = useMockStore.getState().impersonationSessions[activeIdNow];
      if (!current) return;
      // wall_clock_expires_at stored as started_at + 4hr
      const wallClockExpiry = new Date(current.started_at).getTime() + WALL_CLOCK_MS;
      if (Date.now() >= wallClockExpiry) {
        const exitFn = exitRef.current;
        if (exitFn) void exitFn();
      }
    }, WALL_CLOCK_CHECK_INTERVAL_MS);

    return () => {
      document.removeEventListener('mousemove', onActivity);
      document.removeEventListener('keydown', onActivity);
      document.removeEventListener('mousedown', onActivity);
      document.removeEventListener('touchstart', onActivity);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (wallClockRef.current) clearInterval(wallClockRef.current);
    };
  }, [state, resetIdleTimer]);

  return { state, session, entry, exit, extendSession };
}
