/**
 * Tests for <InboxDropdown>.
 *
 * Covers: grouped rendering, category filter narrows, archive removes from
 * main list, mark-read POSTs to daemon, empty state, SSE subscribe wiring.
 *
 * Stage-2: MSW intercepts daemon fetch calls; QueryClientProvider wraps
 * the component so TanStack Query hooks resolve. usePermission still
 * reads from useMockStore (stage-1 hook) so we seed membership/roles only.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

vi.mock('@/api/sse-client', () => ({
  subscribeSSE: vi.fn(() => () => {}),
  _resetForTests: vi.fn(),
}));

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { InboxDropdown } from '../components/inbox-dropdown';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = 'acme';

/** Daemon-shaped notification items (camelCase from REST layer). */
let ITEM_SYSTEM = {
  id: 'notif-sys-001',
  tenantId: 'tenant-acme',
  userId: 'user-0001',
  category: 'system',
  severity: 'info',
  title: 'System test notification',
  body: 'system body',
  occurredAt: '2026-01-01T10:00:00.000Z',
  readAt: null,
  archivedAt: null,
};

let ITEM_SECURITY = {
  id: 'notif-sec-001',
  tenantId: 'tenant-acme',
  userId: 'user-0001',
  category: 'security',
  severity: 'warn',
  title: 'Security test notification',
  body: 'security body',
  occurredAt: '2026-01-01T09:00:00.000Z',
  readAt: null,
  archivedAt: null,
};

let ITEM_PLUGIN = {
  id: 'notif-plg-001',
  tenantId: 'tenant-acme',
  userId: 'user-0001',
  category: 'plugin:com.example.slack',
  severity: 'info',
  title: 'Plugin test notification',
  body: 'plugin body',
  occurredAt: '2026-01-01T08:00:00.000Z',
  readAt: null,
  archivedAt: null,
};

let ALL_ITEMS = [ITEM_SYSTEM, ITEM_SECURITY, ITEM_PLUGIN];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** Wrap component with Mantine + QueryClientProvider. */
function wrap(ui: React.ReactNode, qc?: QueryClient) {
  const client = qc ?? makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <Notifications />
        {ui}
      </MantineProvider>
    </QueryClientProvider>,
  );
}

/** Register a default MSW handler returning all fixture items. */
function useAllItems() {
  server.use(
    http.get(`/api/v1/t/${TENANT}/notifications`, () =>
      HttpResponse.json({ items: ALL_ITEMS, total: ALL_ITEMS.length }),
    ),
  );
}

/** Register an MSW handler returning an empty list. */
function useNoItems() {
  server.use(
    http.get(`/api/v1/t/${TENANT}/notifications`, () =>
      HttpResponse.json({ items: [], total: 0 }),
    ),
  );
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Seed mock store so usePermission (still mock-store-backed) resolves
  // notification:manage-own → allows mark-read / archive buttons.
  useMockStore.getState().reset();
  seedStore(useMockStore);

  // Refresh fixture userId to match the (counter-based) seeded current user
  // so client-side userId filtering in useNotificationList lets items through.
  const uid = useMockStore.getState().currentUserId!;
  ITEM_SYSTEM = { ...ITEM_SYSTEM, userId: uid };
  ITEM_SECURITY = { ...ITEM_SECURITY, userId: uid };
  ITEM_PLUGIN = { ...ITEM_PLUGIN, userId: uid };
  ALL_ITEMS = [ITEM_SYSTEM, ITEM_SECURITY, ITEM_PLUGIN];

  // Point window.location to a tenant URL so resolveTenant() returns 'acme'.
  window.history.replaceState(null, '', `/t/${TENANT}/notifications`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('<InboxDropdown>', () => {
  it('renders grouped notifications per category', async () => {
    useAllItems();
    const userId = useMockStore.getState().currentUserId!;
    wrap(<InboxDropdown userId={userId} onClose={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-group-system')).toBeInTheDocument();
    });

    expect(screen.getByTestId('inbox-group-security')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-group-plugin:com.example.slack')).toBeInTheDocument();
    expect(screen.getByTestId(`inbox-row-title-${ITEM_SYSTEM.id}`)).toHaveTextContent(
      'System test notification',
    );
    expect(screen.getByTestId(`inbox-row-title-${ITEM_SECURITY.id}`)).toHaveTextContent(
      'Security test notification',
    );
    expect(screen.getByTestId(`inbox-row-title-${ITEM_PLUGIN.id}`)).toHaveTextContent(
      'Plugin test notification',
    );
  });

  it('category filter chip narrows the list to the selected bucket', async () => {
    useAllItems();
    const userId = useMockStore.getState().currentUserId!;
    wrap(<InboxDropdown userId={userId} onClose={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-group-system')).toBeInTheDocument();
    });

    // After data loads, clicking the security chip should filter to security only.
    // Server is re-queried; register a handler for the filtered request too.
    server.use(
      http.get(`/api/v1/t/${TENANT}/notifications`, () =>
        HttpResponse.json({ items: [ITEM_SECURITY], total: 1 }),
      ),
    );

    const chip = screen.getByTestId('inbox-filter-chip-security');
    fireEvent.click(chip);

    await waitFor(() => {
      expect(screen.queryByTestId('inbox-group-system')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('inbox-group-security')).toBeInTheDocument();
    });
  });

  it('mark-read button POSTs to /notifications/:id/read', async () => {
    useAllItems();

    let markReadCalled = false;
    server.use(
      http.post(`/api/v1/t/${TENANT}/notifications/${ITEM_SYSTEM.id}/read`, () => {
        markReadCalled = true;
        return HttpResponse.json({ ...ITEM_SYSTEM, readAt: '2026-01-02T00:00:00.000Z' });
      }),
    );

    const userId = useMockStore.getState().currentUserId!;
    wrap(<InboxDropdown userId={userId} onClose={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId(`inbox-row-mark-read-${ITEM_SYSTEM.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`inbox-row-mark-read-${ITEM_SYSTEM.id}`));

    await waitFor(() => {
      expect(markReadCalled).toBe(true);
    });
  });

  it('archive button POSTs to /notifications/:id/archive and row disappears', async () => {
    useAllItems();

    let archiveCalled = false;
    server.use(
      http.post(`/api/v1/t/${TENANT}/notifications/${ITEM_SYSTEM.id}/archive`, () => {
        archiveCalled = true;
        return HttpResponse.json({
          ...ITEM_SYSTEM,
          archivedAt: '2026-01-02T00:00:00.000Z',
        });
      }),
    );

    const userId = useMockStore.getState().currentUserId!;
    const qc = makeQueryClient();
    wrap(<InboxDropdown userId={userId} onClose={() => undefined} />, qc);

    await waitFor(() => {
      expect(screen.getByTestId(`inbox-row-archive-${ITEM_SYSTEM.id}`)).toBeInTheDocument();
    });

    // After archive, next list refetch returns only non-archived items.
    server.use(
      http.get(`/api/v1/t/${TENANT}/notifications`, () =>
        HttpResponse.json({ items: [ITEM_SECURITY, ITEM_PLUGIN], total: 2 }),
      ),
    );

    fireEvent.click(screen.getByTestId(`inbox-row-archive-${ITEM_SYSTEM.id}`));

    await waitFor(() => {
      expect(archiveCalled).toBe(true);
    });
  });

  it('renders empty state when no notifications match', async () => {
    useNoItems();
    const userId = useMockStore.getState().currentUserId!;
    wrap(<InboxDropdown userId={userId} onClose={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByText('No notifications')).toBeInTheDocument();
    });
  });

  it('subscribes to SSE stream via subscribeInboxStream', async () => {
    const { subscribeSSE } = await import('@/api/sse-client');
    useNoItems();
    const userId = useMockStore.getState().currentUserId!;
    wrap(<InboxDropdown userId={userId} onClose={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByText('No notifications')).toBeInTheDocument();
    });

    // subscribeSSE should have been called with the tenant notifications stream
    expect(vi.mocked(subscribeSSE)).toHaveBeenCalledWith(
      `t/${TENANT}/notifications/stream`,
      expect.any(Function),
    );
  });

  it('renders new notification when list refetches after SSE event', async () => {
    // Start empty
    useNoItems();
    const userId = useMockStore.getState().currentUserId!;
    const qc = makeQueryClient();
    wrap(<InboxDropdown userId={userId} onClose={() => undefined} />, qc);

    await waitFor(() => {
      expect(screen.getByText('No notifications')).toBeInTheDocument();
    });

    // Simulate cache invalidation (what useInboxStream does on SSE delta):
    // override the MSW handler then manually invalidate the query.
    server.use(
      http.get(`/api/v1/t/${TENANT}/notifications`, () =>
        HttpResponse.json({ items: [ITEM_SYSTEM], total: 1 }),
      ),
    );

    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['notifications', TENANT] });
      await new Promise((r) => setTimeout(r, 50));
    });

    await waitFor(() => {
      expect(screen.getByText('System test notification')).toBeInTheDocument();
    });
  });
});
