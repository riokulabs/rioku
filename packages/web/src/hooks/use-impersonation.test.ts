/**
 * Tests for `useImpersonation` — thin wrapper around the daemon's
 * super-admin impersonation surface. The audit log + scope builders
 * live server-side, so this suite focuses on the SPA contract:
 * mutation dispatch, state transitions, and the active-id mirror.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useImpersonation } from './use-impersonation';
import type { ImpersonationSession } from '../api/resources';
import { getActiveImpersonationId, setActiveImpersonationId } from '../api/active-impersonation';

// ─── Mocks ────────────────────────────────────────────────────────────────────

let bridgeSession: ImpersonationSession | null = null;
const mockStartMutate = vi.fn();
const mockEndMutate = vi.fn();
const mockTouchMutate = vi.fn();
let startPending = false;
let endPending = false;

vi.mock('../features/security/impersonation/use-impersonation-session', () => ({
  useImpersonationSession: () => bridgeSession,
}));

vi.mock('../features/security/impersonation/realApi', () => ({
  useStartImpersonation: () => ({
    mutateAsync: mockStartMutate,
    isPending: startPending,
  }),
  useEndImpersonation: () => ({
    mutateAsync: mockEndMutate,
    isPending: endPending,
  }),
  useTouchImpersonation: () => ({
    mutateAsync: mockTouchMutate,
    isPending: false,
  }),
  getListImpersonationSessionsQueryKey: () => ['/api/v1/admin/impersonation'],
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

const validEntryOpts = {
  tenant_id: 'tenant-test-01',
  user_id: 'user-target',
  reason: 'Support ticket investigation',
  totpCode: '123456',
  profile: 'minimal' as const,
};

const fakeSession: ImpersonationSession = {
  id: 'imp-0001',
  super_admin_id: 'user-admin',
  tenant_id: 'tenant-test-01',
  user_id: 'user-target',
  reason: validEntryOpts.reason,
  started_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  scope: [],
};

beforeEach(() => {
  bridgeSession = null;
  startPending = false;
  endPending = false;
  mockStartMutate.mockReset();
  mockEndMutate.mockReset();
  mockTouchMutate.mockReset();
  setActiveImpersonationId(null);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useImpersonation', () => {
  it('starts in idle state with no session', () => {
    const { result } = renderHook(() => useImpersonation(), { wrapper });
    expect(result.current.state).toBe('idle');
    expect(result.current.session).toBeNull();
  });

  it('reflects the daemon-reported session as active state', () => {
    bridgeSession = fakeSession;
    const { result } = renderHook(() => useImpersonation(), { wrapper });
    expect(result.current.state).toBe('active');
    expect(result.current.session?.id).toBe('imp-0001');
  });

  it('entry() dispatches the start mutation and mirrors the active id', async () => {
    mockStartMutate.mockResolvedValue({ data: { id: 'imp-0001' }, status: 201 });
    const { result } = renderHook(() => useImpersonation(), { wrapper });

    await act(async () => {
      await result.current.entry(validEntryOpts);
    });

    expect(mockStartMutate).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-test-01',
        targetUserId: 'user-target',
        reason: validEntryOpts.reason,
      },
    });
    expect(getActiveImpersonationId()).toBe('imp-0001');
  });

  it('entry() throws on a malformed TOTP code (still client-side gated)', async () => {
    const { result } = renderHook(() => useImpersonation(), { wrapper });
    await expect(
      act(async () => {
        await result.current.entry({ ...validEntryOpts, totpCode: '12345' });
      }),
    ).rejects.toThrow('Invalid TOTP code');
    expect(mockStartMutate).not.toHaveBeenCalled();
  });

  it('entry() forwards the optional ticketRef when provided', async () => {
    mockStartMutate.mockResolvedValue({ data: { id: 'imp-9999' }, status: 201 });
    const { result } = renderHook(() => useImpersonation(), { wrapper });
    await act(async () => {
      await result.current.entry({ ...validEntryOpts, ticketRef: 'OPS-42' });
    });
    expect(mockStartMutate).toHaveBeenCalledWith({
      data: expect.objectContaining({ ticketRef: 'OPS-42' }) as unknown,
    });
  });

  it('exit() dispatches the end mutation and clears the active id', async () => {
    bridgeSession = fakeSession;
    setActiveImpersonationId(fakeSession.id);
    mockEndMutate.mockResolvedValue({ data: undefined, status: 204 });

    const { result } = renderHook(() => useImpersonation(), { wrapper });

    await act(async () => {
      await result.current.exit();
    });

    expect(mockEndMutate).toHaveBeenCalledWith({ id: 'imp-0001' });
    expect(getActiveImpersonationId()).toBeNull();
  });

  it('exit() with no active session is a safe no-op', async () => {
    bridgeSession = null;
    const { result } = renderHook(() => useImpersonation(), { wrapper });
    await act(async () => {
      await result.current.exit();
    });
    expect(mockEndMutate).not.toHaveBeenCalled();
    expect(getActiveImpersonationId()).toBeNull();
  });

  it('extendSession() dispatches the touch mutation when a session is active', async () => {
    bridgeSession = fakeSession;
    mockTouchMutate.mockResolvedValue({ data: undefined, status: 204 });

    const { result } = renderHook(() => useImpersonation(), { wrapper });
    await act(async () => {
      await result.current.extendSession();
    });

    expect(mockTouchMutate).toHaveBeenCalledWith({ id: 'imp-0001' });
  });

  it('extendSession() with no active session is a safe no-op', async () => {
    bridgeSession = null;
    const { result } = renderHook(() => useImpersonation(), { wrapper });
    await act(async () => {
      await result.current.extendSession();
    });
    expect(mockTouchMutate).not.toHaveBeenCalled();
  });

  it('reports state="entering" while the start mutation is pending', () => {
    startPending = true;
    const { result } = renderHook(() => useImpersonation(), { wrapper });
    expect(result.current.state).toBe('entering');
  });

  it('reports state="exiting" while the end mutation is pending', () => {
    bridgeSession = fakeSession;
    endPending = true;
    const { result } = renderHook(() => useImpersonation(), { wrapper });
    expect(result.current.state).toBe('exiting');
  });
});
