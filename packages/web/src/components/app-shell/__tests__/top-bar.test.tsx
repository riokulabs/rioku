/**
 * Tests for <TopBar> — covers the notifications bell affordance:
 *   - No unread → indicator badge hidden; aria-label says "no unread".
 *   - Unread > 0 → badge shows count; aria-label is dynamic.
 *   - Clicking the bell opens the <InboxDropdown> popover.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';

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

// Stub the daemon-backed current-user hook so the bell knows who it is
// without standing up an /auth/me handler.
vi.mock('@/features/auth/use-current-user', () => ({
  useCurrentUser: () => ({
    data: {
      id: 'user-derrick',
      username: 'derrick',
      displayName: 'Derrick',
      email: 'derrick@rioku.dev',
      roles: ['superadmin'],
      permissions: [],
      status: 'active',
      forcePasswordChange: false,
      totpEnabled: true,
    },
  }),
}));

import { TopBar } from '../top-bar';

function wrap(ui: React.ReactNode, unreadCount = 0) {
  // Top-bar uses TanStack Query for the unread-count fetch — a provider plus
  // an MSW handler returning the count keeps tests deterministic.
  server.use(
    http.get('*/api/v1/t/*/notifications/unread-count', () => HttpResponse.json({ unreadCount })),
    http.get('*/api/v1/t/*/notifications', () => HttpResponse.json({ items: [], total: 0 })),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <Notifications />
        {ui}
      </MantineProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // resolveTenant() reads window.location.pathname; jsdom defaults to '/' which
  // disables the unread-count query. Pin it to acme so the bell's daemon-backed
  // query actually fires under MSW.
  window.history.replaceState({}, '', '/t/acme/dashboard');
  // Inbox dropdown subscribes to SSE via EventSource; jsdom has no implementation.
  // A no-op stub keeps the dropdown open without errors during the popover test.
  if (typeof (globalThis as { EventSource?: unknown }).EventSource === 'undefined') {
    class NoopEventSource {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    (globalThis as { EventSource?: unknown }).EventSource = NoopEventSource;
  }
});

describe('<TopBar> notifications bell', () => {
  it('renders the bell with a dynamic aria-label reflecting unread count', async () => {
    wrap(<TopBar />, 0);
    const bell = await screen.findByTestId('topbar-bell');
    expect(bell).toBeInTheDocument();
    await waitFor(() => {
      const label = bell.getAttribute('aria-label') ?? '';
      // Matches either "no unread" or "N unread".
      expect(label).toMatch(/Notifications,\s(no\sunread|\d+\sunread)/);
    });
  });

  it('hides the indicator badge when unread count is zero', async () => {
    wrap(<TopBar />, 0);
    const bell = await screen.findByTestId('topbar-bell');
    await waitFor(() => {
      expect(bell.getAttribute('aria-label')).toBe('Notifications, no unread');
    });
  });

  it('shows the indicator badge with count when unread > 0', async () => {
    wrap(<TopBar />, 1);
    const bell = await screen.findByTestId('topbar-bell');
    await waitFor(() => {
      expect(bell.getAttribute('aria-label')).toBe('Notifications, 1 unread');
    });
  });

  it('clicking the bell opens the inbox dropdown popover', async () => {
    wrap(<TopBar />, 0);
    const bell = await screen.findByTestId('topbar-bell');
    fireEvent.click(bell);
    // Mantine Popover renders asynchronously via Floating UI — wait for the
    // dropdown body to land in the portal.
    const dropdown = await screen.findByTestId('inbox-dropdown');
    expect(dropdown).toBeInTheDocument();
  });
});
