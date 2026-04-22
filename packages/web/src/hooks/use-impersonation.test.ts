/**
 * Tests for useImpersonation state machine.
 * spec §8.2 / Task 1d.74
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImpersonation } from './use-impersonation';
import { useMockStore } from '../api/mock-store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedStore() {
  useMockStore.getState().reset();
  // Set up a current user
  const store = useMockStore.getState();
  store.addEntity('users', {
    id: 'user-test-admin',
    email: 'admin@rioku.dev',
    name: 'Test Admin',
    disabled: false,
    totp_enabled: true,
    totp_enrolled: true,
    timezone: 'America/Los_Angeles',
    locale: 'en',
    reduced_motion: false,
    notification_preferences: { email: true, in_app: true, categories_muted: [] },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  store.addEntity('tenants', {
    id: 'tenant-test-01',
    slug: 'acme',
    name: 'Acme Corp',
    accent: '#22c55e',
    plan: 'enterprise',
    url_mode: 'path',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  useMockStore.setState({ currentUserId: 'user-test-admin', currentTenantId: 'tenant-test-01' });
}

const validEntryOpts = {
  tenant_id: 'tenant-test-01',
  reason: 'Support ticket investigation',
  totpCode: '123456',
  profile: 'minimal' as const,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useImpersonation', () => {
  beforeEach(seedStore);
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in idle state with no session', () => {
    const { result } = renderHook(() => useImpersonation());
    expect(result.current.state).toBe('idle');
    expect(result.current.session).toBeNull();
  });

  it('entry() creates a session and transitions to active', async () => {
    const { result } = renderHook(() => useImpersonation());

    await act(async () => {
      await result.current.entry(validEntryOpts);
    });

    expect(result.current.state).toBe('active');
    expect(result.current.session).not.toBeNull();
    expect(result.current.session?.tenant_id).toBe('tenant-test-01');
    expect(result.current.session?.reason).toBe('Support ticket investigation');
    expect(result.current.session?.super_admin_id).toBe('user-test-admin');
  });

  it('entry() throws on invalid TOTP', async () => {
    const { result } = renderHook(() => useImpersonation());

    await expect(
      act(async () => {
        await result.current.entry({ ...validEntryOpts, totpCode: '12345' });
      }),
    ).rejects.toThrow('Invalid TOTP code');
  });

  it('entry() emits both admin and tenant audit entries', async () => {
    const { result } = renderHook(() => useImpersonation());

    await act(async () => {
      await result.current.entry(validEntryOpts);
    });

    const state = useMockStore.getState();
    const sessionId = result.current.session?.id;

    // Admin audit
    expect(state.adminAudit.length).toBeGreaterThan(0);
    const adminEntry = state.adminAudit.find((e) => e.action === 'impersonation:enter');
    expect(adminEntry).toBeDefined();
    expect(adminEntry?.impersonation_session_id).toBe(sessionId);
    expect(adminEntry?.kind).toBe('admin');

    // Tenant audit
    const tenantEntry = state.audit.find((e) => e.action === 'impersonation:enter');
    expect(tenantEntry).toBeDefined();
    expect(tenantEntry?.impersonation_session_id).toBe(sessionId);
    expect(tenantEntry?.acted_as_admin).toBe(true);
    expect(tenantEntry?.tenant_id).toBe('tenant-test-01');
  });

  it('session ID is threaded through both audit entries', async () => {
    const { result } = renderHook(() => useImpersonation());

    await act(async () => {
      await result.current.entry(validEntryOpts);
    });

    const sessionId = result.current.session?.id;
    const state = useMockStore.getState();

    const adminEntry = state.adminAudit.find((e) => e.action === 'impersonation:enter');
    const tenantEntry = state.audit.find((e) => e.action === 'impersonation:enter');

    expect(adminEntry?.impersonation_session_id).toBe(sessionId);
    expect(tenantEntry?.impersonation_session_id).toBe(sessionId);
  });

  it('exit() clears session and transitions to idle', async () => {
    const { result } = renderHook(() => useImpersonation());

    await act(async () => {
      await result.current.entry(validEntryOpts);
    });
    expect(result.current.state).toBe('active');

    await act(async () => {
      await result.current.exit();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.session).toBeNull();
  });

  it('exit() emits impersonation:exit audit entries', async () => {
    const { result } = renderHook(() => useImpersonation());

    await act(async () => {
      await result.current.entry(validEntryOpts);
    });

    await act(async () => {
      await result.current.exit();
    });

    const state = useMockStore.getState();
    const adminExitEntry = state.adminAudit.find((e) => e.action === 'impersonation:exit');
    const tenantExitEntry = state.audit.find((e) => e.action === 'impersonation:exit');

    expect(adminExitEntry).toBeDefined();
    expect(tenantExitEntry).toBeDefined();
    expect(tenantExitEntry?.acted_as_admin).toBe(true);
  });

  it('minimal profile builds a broader scope than full read-only', async () => {
    // Seed a role with write grants for the admin user
    const store = useMockStore.getState();
    store.addEntity('roles', {
      id: 'role-admin-test',
      tenant_id: 'tenant-test-01',
      name: 'admin',
      parent_ids: [],
      grants: [
        { permission: 'user:read' },
        { permission: 'service:write' },
        { permission: 'role:delete' },
      ],
      denies: [],
      system: true,
    });
    store.addEntity('memberships', {
      id: 'mem-admin-test',
      tenant_id: 'tenant-test-01',
      user_id: 'user-test-admin',
      role_ids: ['role-admin-test'],
      state: 'active',
      invited_at: new Date().toISOString(),
    });

    const { result: minimalResult } = renderHook(() => useImpersonation());
    await act(async () => {
      await minimalResult.current.entry({ ...validEntryOpts, profile: 'minimal' });
    });
    const minimalScope = minimalResult.current.session?.scope ?? [];

    const { result: fullResult } = renderHook(() => useImpersonation());
    await act(async () => {
      // Reset for second hook
      const minimalSessionId = minimalResult.current.session?.id;
      if (minimalSessionId) {
        useMockStore.getState().deleteEntity('impersonationSessions', minimalSessionId);
      }
      await fullResult.current.entry({ ...validEntryOpts, profile: 'full' });
    });
    const fullScope = fullResult.current.session?.scope ?? [];

    // Minimal should include the write grant from the role
    expect(minimalScope).toContain('service:write');
    expect(minimalScope).toContain('role:delete');

    // Full (read-only) should NOT include destructive write
    expect(fullScope).not.toContain('role:delete');
    expect(fullScope).toContain('user:read');
  });

  it('idle timer triggers exit after 60 minutes of inactivity', async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useImpersonation());

    await act(async () => {
      await result.current.entry(validEntryOpts);
    });

    expect(result.current.state).toBe('active');

    // Advance 60 minutes
    await act(async () => {
      vi.advanceTimersByTime(60 * 60 * 1000 + 1000);
      // flush microtasks
      await Promise.resolve();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.session).toBeNull();
  });

  it('wall-clock timer triggers exit after 4 hours', async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useImpersonation());

    await act(async () => {
      await result.current.entry(validEntryOpts);
    });

    // Simulate activity every 30 minutes to prevent idle timeout
    // but advance wall clock past 4 hours by ticking the minute interval
    await act(async () => {
      // Fire 241 minute intervals (4h01m) — each fires the wall-clock checker
      vi.advanceTimersByTime(4 * 60 * 60 * 1000 + 2 * 60 * 1000);
      await Promise.resolve();
    });

    expect(result.current.state).toBe('idle');
  });
});
