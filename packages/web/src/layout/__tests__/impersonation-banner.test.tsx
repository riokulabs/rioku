/**
 * Tests for <ImpersonationBanner>.
 *
 * Stage-2: the banner exclusively reads from `useImpersonation` (which is
 * itself daemon-backed). We mock that hook + the admin tenants query so
 * the banner has a tenant directory to look up the friendly name.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { ImpersonationBanner } from '../impersonation-banner';

// ─── Router mock ──────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ─── useImpersonation mock ────────────────────────────────────────────────────

const mockExit = vi.fn().mockResolvedValue(undefined);
const mockEntry = vi.fn().mockResolvedValue(undefined);
const mockExtend = vi.fn().mockResolvedValue(undefined);

const activeSession = {
  id: 'imp-0001',
  super_admin_id: 'user-admin',
  tenant_id: 'tenant-acme',
  reason: 'Support ticket investigation',
  ticketRef: '#1234',
  started_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  scope: ['user:read'],
};

let mockSession: typeof activeSession | null = null;

vi.mock('@/hooks/use-impersonation', () => ({
  useImpersonation: () => ({
    state: mockSession ? 'active' : 'idle',
    session: mockSession,
    entry: mockEntry,
    exit: mockExit,
    extendSession: mockExtend,
  }),
}));

// Tenant directory — feeds the friendly name lookup.
vi.mock('@/api/generated/admin/admin', () => ({
  useListAdminTenants: () => ({
    data: {
      data: {
        items: [{ id: 'tenant-acme', slug: 'acme', name: 'Acme Corp' }],
      },
    },
  }),
}));

// The idle-modal subtree imports the realApi hooks; stub them so the test
// doesn't try to drive their internals.
vi.mock('@/features/security/impersonation/realApi', () => ({
  useEndImpersonation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTouchImpersonation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStartImpersonation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useListImpersonationSessions: () => ({ data: undefined }),
  getListImpersonationSessionsQueryKey: () => ['/api/v1/admin/impersonation'],
}));

vi.mock('@/features/security/impersonation/use-impersonation-session', () => ({
  useImpersonationSession: () => mockSession,
}));

// Stub modals since they are opened imperatively
vi.mock('@mantine/modals', () => ({
  modals: {
    openConfirmModal: vi.fn((opts: { onConfirm?: () => void }) => {
      opts.onConfirm?.();
    }),
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ImpersonationBanner', () => {
  beforeEach(() => {
    mockSession = null;
    mockExit.mockReset();
    mockExit.mockResolvedValue(undefined);
    mockNavigate.mockReset();
  });

  it('returns null when no session is active', () => {
    mockSession = null;
    renderWithProviders(<ImpersonationBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders when session is active', () => {
    mockSession = activeSession;
    renderWithProviders(<ImpersonationBanner />);

    expect(screen.getByText(/acting as super-admin/i)).toBeDefined();
    expect(screen.getByText(/Acme Corp/i)).toBeDefined();
    expect(screen.getByText(/Support ticket investigation/i)).toBeDefined();
    expect(screen.getByText(/imp-0001/)).toBeDefined();
  });

  it('shows ticket ref as text for non-URL references', () => {
    mockSession = { ...activeSession, ticketRef: '#1234' };
    renderWithProviders(<ImpersonationBanner />);
    expect(screen.getByText('#1234')).toBeDefined();
  });

  it('shows ticket ref as link for URL references', () => {
    mockSession = {
      ...activeSession,
      ticketRef: 'https://jira.example.com/browse/OPS-123',
    };
    renderWithProviders(<ImpersonationBanner />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://jira.example.com/browse/OPS-123');
  });

  it('shows "End session" button', () => {
    mockSession = activeSession;
    renderWithProviders(<ImpersonationBanner />);
    expect(screen.getByRole('button', { name: /end session/i })).toBeDefined();
  });

  it('clicking exit button calls useImpersonation.exit() via confirm modal', async () => {
    mockSession = activeSession;
    const user = userEvent.setup();
    renderWithProviders(<ImpersonationBanner />);

    const exitBtn = screen.getByRole('button', { name: /end session/i });
    await user.click(exitBtn);

    await waitFor(() => {
      expect(mockExit).toHaveBeenCalled();
    });
  });

  it('navigates to /admin after exit', async () => {
    mockSession = activeSession;
    const user = userEvent.setup();
    renderWithProviders(<ImpersonationBanner />);

    const exitBtn = screen.getByRole('button', { name: /end session/i });
    await user.click(exitBtn);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/admin' });
    });
  });
});
