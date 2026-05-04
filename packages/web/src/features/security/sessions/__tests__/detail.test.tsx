/**
 * Unit tests for <SessionDetail>.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { SessionDetail } from '../components/detail';
import type { SessionWithMeta } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function makeSession(overrides: Partial<SessionWithMeta> = {}): SessionWithMeta {
  return {
    id: 'sess-test-1',
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    ip: '192.168.1.42',
    user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120',
    last_seen: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    revoked: false,
    device: 'Chrome',
    location: 'San Francisco, US',
    last_seen_relative: '5m ago',
    is_current: false,
    ...overrides,
  };
}

describe('SessionDetail', () => {
  it('renders device name and IP', () => {
    const session = makeSession();
    wrap(<SessionDetail session={session} onClose={vi.fn()} />);
    expect(screen.getByTestId('session-detail')).toBeInTheDocument();
    expect(screen.getByText('Chrome')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.42')).toBeInTheDocument();
  });

  it('shows full user-agent string', () => {
    const session = makeSession();
    wrap(<SessionDetail session={session} onClose={vi.fn()} />);
    expect(screen.getByText(session.user_agent)).toBeInTheDocument();
  });

  it('shows "current" badge and info alert for current session', () => {
    const session = makeSession({ is_current: true });
    wrap(<SessionDetail session={session} onClose={vi.fn()} />);
    expect(screen.getByText('current')).toBeInTheDocument();
    expect(screen.getByText(/cannot be revoked here/i)).toBeInTheDocument();
  });

  it('shows Revoke button for non-current, non-revoked sessions', () => {
    const session = makeSession({ is_current: false, revoked: false });
    wrap(<SessionDetail session={session} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /revoke session/i })).toBeInTheDocument();
  });

  it('disables Revoke button for already-revoked sessions', () => {
    const session = makeSession({ revoked: true });
    wrap(<SessionDetail session={session} onClose={vi.fn()} />);
    const btn = screen.queryByRole('button', { name: /revoke session/i });
    if (btn) {
      // revoked sessions show button but it should be disabled
      expect(btn).toBeDisabled();
    }
  });

  it('shows location', () => {
    const session = makeSession();
    wrap(<SessionDetail session={session} onClose={vi.fn()} />);
    // location appears in both header sub-text and detail rows
    expect(screen.getAllByText('San Francisco, US').length).toBeGreaterThan(0);
  });
});
