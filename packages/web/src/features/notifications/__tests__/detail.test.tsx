/**
 * Tests for <NotificationDetail> — header, body, metadata, toggle-read +
 * toggle-archive actions hit daemon endpoints.
 *
 * Stage-2: Component accepts `item` as props; mutations call daemon via
 * customFetch. MSW intercepts POST calls so we can assert endpoint was hit.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { server } from '@/test/msw-server';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

vi.mock('@/hooks/use-permission', () => ({
  usePermission: () => true,
}));

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { NotificationDetail } from '../components/detail';
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
      <MantineProvider>
        <Notifications />
        {children}
      </MantineProvider>
    </QueryClientProvider>
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
  // Seed mock store so usePermission resolves notification:manage-own.
  useMockStore.getState().reset();
  seedStore(useMockStore);

  window.history.replaceState(null, '', `/t/${TENANT}/notifications`);
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

  it('toggle-read POSTs to /notifications/:id/read', async () => {
    let markReadCalled = false;
    server.use(
      http.post(`*/api/v1/t/${TENANT}/notifications/n-1/read`, () => {
        markReadCalled = true;
        return HttpResponse.json({
          ...makeItem(),
          readAt: '2026-04-10T13:00:00.000Z',
        });
      }),
    );

    render(<NotificationDetail item={makeItem()} onClose={() => undefined} />, {
      wrapper: Wrapper,
    });
    const btn = screen.getByTestId('notification-detail-toggle-read');
    expect(btn).toHaveTextContent('Mark as read');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(markReadCalled).toBe(true);
    });
  });

  it('toggle-archive POSTs to /notifications/:id/archive', async () => {
    let archiveCalled = false;
    server.use(
      http.post(`*/api/v1/t/${TENANT}/notifications/n-1/archive`, () => {
        archiveCalled = true;
        return HttpResponse.json({
          ...makeItem(),
          archivedAt: '2026-04-10T13:00:00.000Z',
        });
      }),
    );

    const item = makeItem();
    render(<NotificationDetail item={item} onClose={() => undefined} />, {
      wrapper: Wrapper,
    });
    const btn = screen.getByTestId('notification-detail-toggle-archive');
    expect(btn).toHaveTextContent('Archive');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(archiveCalled).toBe(true);
    });
  });
});
