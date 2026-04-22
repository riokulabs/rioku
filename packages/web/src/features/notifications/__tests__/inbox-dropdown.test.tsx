/**
 * Tests for <InboxDropdown>.
 *
 * Covers: grouped rendering, category filter narrows, archive removes from
 * main list, mark-read updates unread count via store, empty state, subscribe
 * handling when a new notification lands on the bus.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
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

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { emitNotification } from '../api';
import { InboxDropdown } from '../components/inbox-dropdown';
import type { ID, NotificationItem } from '@/api/resources/types';

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

function setupFixture(): {
  userId: ID;
  system: NotificationItem;
  security: NotificationItem;
  plugin: NotificationItem;
} {
  const userId = currentUserId();
  // Replace the store's notifications with a small deterministic fixture so we
  // can assert specific groups / rows without wrestling with seed noise.
  useMockStore.setState({ notifications: {} });
  const tenantId = useMockStore.getState().currentTenantId;
  const system = emitNotification({
    tenant_id: tenantId,
    user_id: userId,
    category: 'system',
    severity: 'info',
    title: 'System test notification',
    body: 'system body',
  });
  const security = emitNotification({
    tenant_id: tenantId,
    user_id: userId,
    category: 'security',
    severity: 'warn',
    title: 'Security test notification',
    body: 'security body',
  });
  const plugin = emitNotification({
    tenant_id: tenantId,
    user_id: userId,
    category: 'plugin:com.example.slack',
    severity: 'info',
    title: 'Plugin test notification',
    body: 'plugin body',
  });
  return { userId, system, security, plugin };
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<InboxDropdown>', () => {
  it('renders grouped notifications per category', () => {
    const { userId, system, security, plugin } = setupFixture();
    wrap(<InboxDropdown userId={userId} onClose={() => undefined} />);
    expect(screen.getByTestId('inbox-group-system')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-group-security')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-group-plugin:com.example.slack')).toBeInTheDocument();
    expect(screen.getByTestId(`inbox-row-title-${system.id}`)).toHaveTextContent(
      'System test notification',
    );
    expect(screen.getByTestId(`inbox-row-title-${security.id}`)).toHaveTextContent(
      'Security test notification',
    );
    expect(screen.getByTestId(`inbox-row-title-${plugin.id}`)).toHaveTextContent(
      'Plugin test notification',
    );
  });

  it('category filter chip narrows the list to the selected bucket', () => {
    const { userId } = setupFixture();
    wrap(<InboxDropdown userId={userId} onClose={() => undefined} />);
    // The Mantine Chip's test-id lands on the input itself — clicking it
    // toggles the multi-select chip group state.
    const input = screen.getByTestId('inbox-filter-chip-security');
    fireEvent.click(input);
    expect(screen.queryByTestId('inbox-group-system')).not.toBeInTheDocument();
    expect(screen.getByTestId('inbox-group-security')).toBeInTheDocument();
  });

  it('mark-read button marks a notification read in the store', async () => {
    const { userId, system } = setupFixture();
    wrap(<InboxDropdown userId={userId} onClose={() => undefined} />);
    const btn = screen.getByTestId(`inbox-row-mark-read-${system.id}`);
    fireEvent.click(btn);
    await waitFor(() => {
      const stored = useMockStore.getState().notifications[system.id];
      expect(stored?.read_at).not.toBeNull();
    });
  });

  it('archive button removes a row from the default (non-archived) view', async () => {
    const { userId, system } = setupFixture();
    wrap(<InboxDropdown userId={userId} onClose={() => undefined} />);
    const btn = screen.getByTestId(`inbox-row-archive-${system.id}`);
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.queryByTestId(`inbox-row-${system.id}`)).not.toBeInTheDocument();
    });
  });

  it('renders empty state when no notifications match', () => {
    const userId = currentUserId();
    useMockStore.setState({ notifications: {} });
    wrap(<InboxDropdown userId={userId} onClose={() => undefined} />);
    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });

  it('subscribes to new emits and re-renders when a notification lands', () => {
    const userId = currentUserId();
    useMockStore.setState({ notifications: {} });
    wrap(<InboxDropdown userId={userId} onClose={() => undefined} />);
    expect(screen.getByText('No notifications')).toBeInTheDocument();
    act(() => {
      emitNotification({
        tenant_id: useMockStore.getState().currentTenantId,
        user_id: userId,
        category: 'system',
        severity: 'info',
        title: 'Live emit',
        body: 'live body',
      });
    });
    expect(screen.getByText('Live emit')).toBeInTheDocument();
  });
});
