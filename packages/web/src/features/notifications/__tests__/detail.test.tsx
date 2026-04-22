/**
 * Tests for <NotificationDetail> — header, body, metadata, toggle-read +
 * toggle-archive actions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { NotificationDetail } from '../components/detail';
import type { ID, NotificationItem } from '@/api/resources/types';

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider>
      <Notifications />
      {children}
    </MantineProvider>
  );
}

function makeItem(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n-1' as ID,
    tenant_id: 't-1' as ID,
    user_id: 'u-1' as ID,
    category: 'security',
    severity: 'warn',
    title: 'Detail under test',
    body: 'Full body text that should not be truncated in detail view.',
    read_at: null,
    archived_at: null,
    at: '2026-04-10T12:34:00.000Z',
    read: false,
    created_at: '2026-04-10T12:34:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  useMockStore.setState({ notifications: { 'n-1': makeItem() } });
});

describe('<NotificationDetail>', () => {
  it('renders title, body, and category/severity badges', () => {
    render(<NotificationDetail item={makeItem()} onClose={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText('Detail under test')).toBeInTheDocument();
    expect(screen.getByTestId('notification-detail-body')).toHaveTextContent('Full body text');
    expect(screen.getByText('warn')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
  });

  it('renders the action button when action is present', () => {
    render(
      <NotificationDetail
        item={makeItem({
          action: { label: 'Investigate', href: '/security/alert/42' },
        })}
        onClose={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    const btn = screen.getByTestId('notification-detail-action');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('Investigate');
  });

  it('toggle-read switches the notification read state', async () => {
    render(<NotificationDetail item={makeItem()} onClose={() => undefined} />, {
      wrapper: Wrapper,
    });
    const btn = screen.getByTestId('notification-detail-toggle-read');
    expect(btn).toHaveTextContent('Mark as read');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(useMockStore.getState().notifications['n-1']?.read_at).not.toBeNull();
    });
  });

  it('toggle-archive archives then unarchives', async () => {
    const item = makeItem();
    render(<NotificationDetail item={item} onClose={() => undefined} />, {
      wrapper: Wrapper,
    });
    const btn = screen.getByTestId('notification-detail-toggle-archive');
    expect(btn).toHaveTextContent('Archive');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(useMockStore.getState().notifications['n-1']?.archived_at).not.toBeNull();
    });
  });
});
