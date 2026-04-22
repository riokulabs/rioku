/**
 * Tests for <NotificationList> — row rendering, state badge, action buttons
 * dispatch mark-read / archive, row click selects detail.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { NotificationList } from '../components/list';
import type { ID, NotificationItem } from '@/api/resources/types';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

function makeItem(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n-1' as ID,
    tenant_id: 't-1' as ID,
    user_id: 'u-1' as ID,
    category: 'system',
    severity: 'info',
    title: 'Row under test',
    body: 'body',
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

describe('<NotificationList>', () => {
  it('renders the title, category chip, and state badge for a row', () => {
    render(<NotificationList rows={[makeItem()]} onSelect={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText('Row under test')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('unread')).toBeInTheDocument();
  });

  it('row click dispatches onSelect', () => {
    const onSelect = vi.fn();
    render(<NotificationList rows={[makeItem()]} onSelect={onSelect} />, {
      wrapper: Wrapper,
    });
    fireEvent.click(screen.getByTestId('notification-row-title-n-1'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'n-1' }));
  });

  it('mark-read action updates the store', async () => {
    render(<NotificationList rows={[makeItem()]} onSelect={() => undefined} />, {
      wrapper: Wrapper,
    });
    const btn = screen.getByTestId('notification-row-mark-read-n-1');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(useMockStore.getState().notifications['n-1']?.read_at).not.toBeNull();
    });
  });

  it('archive action updates the store', async () => {
    render(<NotificationList rows={[makeItem()]} onSelect={() => undefined} />, {
      wrapper: Wrapper,
    });
    const btn = screen.getByTestId('notification-row-archive-n-1');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(useMockStore.getState().notifications['n-1']?.archived_at).not.toBeNull();
    });
  });
});
