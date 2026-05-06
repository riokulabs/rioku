/**
 * Tests for the impersonation idle-extend timer + modal.
 *
 *   - Modal stays hidden when remaining time is above the warning threshold.
 *   - Modal shows once remaining time crosses the threshold.
 *   - Clicking "Extend session" calls `extendSession` (mock) or the
 *     daemon touch mutation (real).
 *   - Once the wall-clock crosses zero the modal reflects the
 *     expired state and the extend button disappears.
 *
 * spec §8.2 / Task 1d.77
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ImpersonationIdleModal } from '../components/idle-modal';

// ─── mocks ────────────────────────────────────────────────────────────────────

const mockExtendSession = vi.fn();
let mockSession: {
  id: string;
  super_admin_id: string;
  tenant_id: string;
  reason: string;
  started_at: string;
  expires_at: string;
  scope: string[];
} | null = null;

vi.mock('@/hooks/use-impersonation', () => ({
  useImpersonation: () => ({
    state: mockSession ? 'active' : 'idle',
    session: mockSession,
    entry: vi.fn(),
    exit: vi.fn(),
    extendSession: mockExtendSession,
  }),
}));

vi.mock('../use-impersonation-session', () => ({
  useImpersonationSession: () => mockSession,
}));

const mockTouchMutate = vi.fn().mockResolvedValue({ data: {}, status: 200 });

vi.mock('../realApi', () => ({
  useTouchImpersonation: () => ({
    mutateAsync: mockTouchMutate,
    isPending: false,
  }),
  getListImpersonationSessionsQueryKey: () => ['/api/v1/admin/impersonation'],
}));

// ─── isRealApi mock — flip per-test ──────────────────────────────────────────

const realApiMock = vi.hoisted(() => ({ value: false }));
vi.mock('@/api/mode', () => ({
  isRealApi: () => realApiMock.value,
  useMocks: () => !realApiMock.value,
}));

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeSession(secondsUntilExpiry: number) {
  return {
    id: 'imp-test-001',
    super_admin_id: 'user-admin',
    tenant_id: 'tenant-acme',
    reason: 'Investigating support ticket OPS-123',
    started_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + secondsUntilExpiry * 1000).toISOString(),
    scope: [],
  };
}

beforeEach(() => {
  mockExtendSession.mockReset();
  mockTouchMutate.mockReset();
  mockTouchMutate.mockResolvedValue({ data: {}, status: 200 });
  realApiMock.value = false;
  mockSession = null;
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe('ImpersonationIdleModal', () => {
  it('renders nothing when no session is active', () => {
    mockSession = null;
    renderWithProviders(<ImpersonationIdleModal />);
    expect(screen.queryByText(/expiring/i)).toBeNull();
  });

  it('stays hidden while remaining time is above the warning threshold', () => {
    mockSession = makeSession(120); // 2 minutes
    renderWithProviders(<ImpersonationIdleModal warningThresholdSec={60} />);
    expect(screen.queryByText(/Impersonation session expiring/i)).toBeNull();
  });

  it('shows the warning modal once remaining time crosses the threshold', () => {
    mockSession = makeSession(45); // already inside 60s window
    renderWithProviders(<ImpersonationIdleModal warningThresholdSec={60} />);
    expect(screen.getByText(/Impersonation session expiring/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /extend session/i })).toBeDefined();
  });

  it('calls extendSession (mock mode) when "Extend session" is clicked', async () => {
    mockSession = makeSession(30);
    realApiMock.value = false;
    renderWithProviders(<ImpersonationIdleModal warningThresholdSec={60} />);

    const btn = screen.getByRole('button', { name: /extend session/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockExtendSession).toHaveBeenCalledTimes(1);
    });
    expect(mockTouchMutate).not.toHaveBeenCalled();
  });

  it('calls daemon touch mutation (real mode) when "Extend session" is clicked', async () => {
    mockSession = makeSession(30);
    realApiMock.value = true;
    renderWithProviders(<ImpersonationIdleModal warningThresholdSec={60} />);

    const btn = screen.getByRole('button', { name: /extend session/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockTouchMutate).toHaveBeenCalledTimes(1);
    });
    expect(mockTouchMutate).toHaveBeenCalledWith({ id: 'imp-test-001' });
    expect(mockExtendSession).not.toHaveBeenCalled();
  });

  it('reflects the expired state once the session is past expires_at', () => {
    // -5s = already expired
    mockSession = makeSession(-5);
    renderWithProviders(<ImpersonationIdleModal warningThresholdSec={60} />);
    expect(screen.getByText(/has expired/i)).toBeDefined();
    // No extend button when expired
    expect(screen.queryByRole('button', { name: /extend session/i })).toBeNull();
  });
});
