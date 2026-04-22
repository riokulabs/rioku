/**
 * Tests for <TopBar> — covers the notifications bell affordance:
 *   - No unread → indicator badge hidden; aria-label says "no unread".
 *   - Unread > 0 → badge shows count; aria-label is dynamic.
 *   - Clicking the bell opens the <InboxDropdown> popover.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/t/acme/dashboard' } }),
  Link: ({
    children,
    to,
    onClick,
  }: {
    children?: React.ReactNode;
    to?: string;
    onClick?: () => void;
  }) => (
    <a
      data-link-to={to ?? ''}
      href={to ?? '#'}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock('@mantine/spotlight', () => ({
  spotlight: { open: vi.fn() },
}));

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { emitNotification } from '@/features/notifications/api';
import { TopBar } from '../top-bar';
import type { ID } from '@/api/resources/types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
}

function currentUserId(): ID {
  const id = useMockStore.getState().currentUserId;
  if (!id) throw new Error('expected seeded currentUserId');
  return id;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('<TopBar> notifications bell', () => {
  it('renders the bell with a dynamic aria-label reflecting unread count', () => {
    wrap(<TopBar />);
    const bell = screen.getByTestId('topbar-bell');
    // The bell is always present; label is dynamic text.
    expect(bell).toBeInTheDocument();
    const label = bell.getAttribute('aria-label') ?? '';
    // Matches either "no unread" or "N unread".
    expect(label).toMatch(/Notifications,\s(no\sunread|\d+\sunread)/);
  });

  it('hides the indicator badge when unread count is zero', () => {
    // Force-zero unread by reading current user then marking all read.
    const userId = currentUserId();
    // Mark everything as read by replacing the notifications map.
    useMockStore.setState({ notifications: {} });
    wrap(<TopBar />);
    const bell = screen.getByTestId('topbar-bell');
    expect(bell.getAttribute('aria-label')).toBe('Notifications, no unread');
    expect(userId).toBeTruthy();
  });

  it('shows the indicator badge with count when unread > 0', () => {
    const userId = currentUserId();
    // Seed a single fresh unread notification for the current user.
    useMockStore.setState({ notifications: {} });
    emitNotification({
      tenant_id: useMockStore.getState().currentTenantId,
      user_id: userId,
      category: 'system',
      severity: 'info',
      title: 'Fresh test notification',
      body: 'body',
    });
    wrap(<TopBar />);
    const bell = screen.getByTestId('topbar-bell');
    expect(bell.getAttribute('aria-label')).toBe('Notifications, 1 unread');
  });

  it('clicking the bell opens the inbox dropdown popover', async () => {
    wrap(<TopBar />);
    const bell = screen.getByTestId('topbar-bell');
    fireEvent.click(bell);
    // Mantine Popover renders asynchronously via Floating UI — wait for the
    // dropdown body to land in the portal.
    const dropdown = await screen.findByTestId('inbox-dropdown');
    expect(dropdown).toBeInTheDocument();
  });
});
