/**
 * Tests for <NotificationDetail> — covers the two issue-#238/#239 wires:
 *   1. "Mark as unread" button posts to /unread (no longer a degraded toast).
 *   2. tenant_id renders as the resolved slug when /identity returns it.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { server } from '@/test/msw-server';

vi.mock('@/hooks/use-permission', () => ({
  usePermission: () => true,
}));

vi.mock('@/hooks/use-notify', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { notify } from '@/hooks/use-notify';
import { NotificationDetail } from '../components/detail';
import type { NotificationItem } from '@/api/resources';

const notifyMock = vi.mocked(notify);

const TENANT = 'acme';
const TENANT_UUID = 'tenant_acme_uuid';

function setTenantUrl() {
  window.history.replaceState(null, '', `/t/${TENANT}/notifications/n1`);
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = makeQueryClient();
  return (
    <QueryClientProvider client={qc}>
      <MantineProvider>{children}</MantineProvider>
    </QueryClientProvider>
  );
}

function makeItem(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n1',
    tenant_id: TENANT_UUID,
    user_id: 'u1',
    category: 'system',
    severity: 'info',
    title: 'Hello',
    body: 'world',
    read_at: null,
    archived_at: null,
    at: '2026-05-07T12:00:00.000Z',
    read: false,
    created_at: '2026-05-07T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  setTenantUrl();
  notifyMock.success.mockClear();
  notifyMock.error.mockClear();
  notifyMock.info.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NotificationDetail — mark unread (issue #238)', () => {
  it('POSTs to /unread and emits a success toast when item is read', async () => {
    let unreadCalled = false;
    server.use(
      http.get(`/api/v1/t/${TENANT}/identity`, () =>
        HttpResponse.json({ id: TENANT_UUID, slug: TENANT, name: 'Acme' }),
      ),
      http.post(`/api/v1/t/${TENANT}/notifications/n1/unread`, () => {
        unreadCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const item = makeItem({ read_at: '2026-05-07T12:30:00.000Z' });
    render(
      <Wrapper>
        <NotificationDetail item={item} onClose={() => {}} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByTestId('notification-detail-toggle-read'));
    await waitFor(() => {
      expect(unreadCalled).toBe(true);
    });
    await waitFor(() => {
      expect(notifyMock.success).toHaveBeenCalledWith('Marked as unread');
    });
    // The old degraded toast must NOT fire.
    expect(notifyMock.info).not.toHaveBeenCalledWith(
      'Mark unread',
      'This action is not yet available.',
    );
  });

  it('emits an error toast when /unread fails', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/identity`, () =>
        HttpResponse.json({ id: TENANT_UUID, slug: TENANT, name: 'Acme' }),
      ),
      http.post(`/api/v1/t/${TENANT}/notifications/n1/unread`, () =>
        HttpResponse.json({ title: 'forbidden' }, { status: 403 }),
      ),
    );
    const item = makeItem({ read_at: '2026-05-07T12:30:00.000Z' });
    render(
      <Wrapper>
        <NotificationDetail item={item} onClose={() => {}} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId('notification-detail-toggle-read'));
    await waitFor(() => {
      expect(notifyMock.error).toHaveBeenCalled();
    });
  });
});

describe('NotificationDetail — tenant identity slug (issue #239)', () => {
  it('renders the resolved tenant slug as a badge when ids match', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/identity`, () =>
        HttpResponse.json({ id: TENANT_UUID, slug: TENANT, name: 'Acme' }),
      ),
    );
    const item = makeItem({ tenant_id: TENANT_UUID });
    render(
      <Wrapper>
        <NotificationDetail item={item} onClose={() => {}} />
      </Wrapper>,
    );
    // The slug appears in a Badge alongside the IdBadge for the UUID.
    await waitFor(() => {
      expect(screen.getByText(TENANT)).toBeInTheDocument();
    });
  });

  it('omits the slug badge when the resolved id does not match the notification tenant id', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/identity`, () =>
        HttpResponse.json({ id: 'tenant_other_uuid', slug: TENANT, name: 'Acme' }),
      ),
    );
    const item = makeItem({ tenant_id: TENANT_UUID });
    render(
      <Wrapper>
        <NotificationDetail item={item} onClose={() => {}} />
      </Wrapper>,
    );
    // Wait for query to settle, then verify slug is NOT rendered as a badge.
    await new Promise((r) => setTimeout(r, 50));
    // The TENANT slug string ("acme") should not appear as a label here.
    // Use queryAllByText to allow the URL render (which happens in IdBadge for the UUID, not the slug).
    const matches = screen.queryAllByText(TENANT);
    expect(matches.length).toBe(0);
  });
});
