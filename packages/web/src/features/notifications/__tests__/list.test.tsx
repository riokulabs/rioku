/**
 * Tests for <NotificationList> — row rendering, state badge, action buttons
 * dispatch mark-read / archive via daemon endpoints.
 *
 * Stage-2: The component accepts `rows` as props; mutations call daemon via
 * customFetch. MSW intercepts mutation calls so we can assert the correct
 * endpoint was hit without touching mock-store state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { server } from '@/test/msw-server';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { NotificationList } from '../components/list';
import type { ID, NotificationItem } from '@/api/resources';

const TENANT = 'acme';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      <MantineProvider>{children}</MantineProvider>
    </QueryClientProvider>
  );
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
  // Seed mock store so usePermission resolves notification:manage-own.
  useMockStore.getState().reset();
  seedStore(useMockStore);

  Object.defineProperty(window, 'location', {
    value: { pathname: `/t/${TENANT}/notifications` },
    writable: true,
  });
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

  it('mark-read action POSTs to /notifications/:id/read', async () => {
    let markReadCalled = false;
    server.use(
      http.post(`/api/v1/t/${TENANT}/notifications/n-1/read`, () => {
        markReadCalled = true;
        return HttpResponse.json({
          ...makeItem(),
          readAt: '2026-04-10T13:00:00.000Z',
        });
      }),
    );

    render(<NotificationList rows={[makeItem()]} onSelect={() => undefined} />, {
      wrapper: Wrapper,
    });
    const btn = screen.getByTestId('notification-row-mark-read-n-1');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(markReadCalled).toBe(true);
    });
  });

  it('archive action POSTs to /notifications/:id/archive', async () => {
    let archiveCalled = false;
    server.use(
      http.post(`/api/v1/t/${TENANT}/notifications/n-1/archive`, () => {
        archiveCalled = true;
        return HttpResponse.json({
          ...makeItem(),
          archivedAt: '2026-04-10T13:00:00.000Z',
        });
      }),
    );

    render(<NotificationList rows={[makeItem()]} onSelect={() => undefined} />, {
      wrapper: Wrapper,
    });
    const btn = screen.getByTestId('notification-row-archive-n-1');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(archiveCalled).toBe(true);
    });
  });
});
