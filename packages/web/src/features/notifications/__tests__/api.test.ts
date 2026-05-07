/**
 * Tests for the notifications (inbox) API — real daemon-backed layer.
 *
 * Uses MSW to intercept fetch calls to /api/v1/t/:tenant/notifications/* and
 * TanStack Query for hook rendering. Tests verify:
 *   - useNotificationList filter mapping + client-side narrowing
 *   - useUnreadCount
 *   - markRead / markAllRead / archive / unarchive mutations
 *   - subscribeInboxStream → subscribeSSE delegation
 *   - emitNotification (client-side only — no daemon call)
 *
 * @read-only tests only assert; no state mutation without assertion.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { server } from '@/test/msw-server';

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));
import { notifications as mantineNotifications } from '@mantine/notifications';

vi.mock('@/api/sse-client', () => ({
  subscribeSSE: vi.fn(() => () => {}),
  _resetForTests: vi.fn(),
}));
import { subscribeSSE } from '@/api/sse-client';

import {
  archive,
  emitNotification,
  markAllRead,
  markRead,
  subscribeInboxStream,
  unarchive,
  useNotificationDetail,
  useNotificationList,
  useUnreadCount,
} from '../api';
import type { InboxFilter } from '../types';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

function emptyFilter(): InboxFilter {
  return {
    categories: [],
    severities: [],
    unreadOnly: false,
    includeArchived: false,
    search: '',
  };
}

const TENANT = 'acme';

// Seed the URL so resolveTenant() finds /t/acme/. Set pathname only so that
// jsdom retains the default `origin` and fetch can resolve relative URLs.
function setTenantUrl() {
  window.history.replaceState(null, '', `/t/${TENANT}/notifications`);
}

const ITEM_A = {
  id: 'notif-0001',
  tenantId: 'tenant-001',
  userId: 'user-001',
  category: 'system',
  severity: 'info',
  title: 'API Key expiring',
  body: 'Your API key expires in 7 days.',
  occurredAt: '2025-01-01T10:00:00.000Z',
  readAt: null,
  archivedAt: null,
};
const ITEM_B = {
  id: 'notif-0002',
  tenantId: 'tenant-001',
  userId: 'user-001',
  category: 'security',
  severity: 'warn',
  title: 'Suspicious login',
  body: 'Login from an unknown device.',
  occurredAt: '2025-01-01T09:00:00.000Z',
  readAt: '2025-01-01T09:30:00.000Z',
  archivedAt: null,
};

beforeEach(() => {
  setTenantUrl();
  vi.mocked(mantineNotifications.show).mockClear();
  vi.mocked(subscribeSSE).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── useNotificationList ──────────────────────────────────────────────────────

describe('useNotificationList', () => {
  it('@read-only returns items sorted desc by at', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/notifications`, () =>
        HttpResponse.json({ items: [ITEM_A, ITEM_B], total: 2 }),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useNotificationList('user-001', emptyFilter()), {
      wrapper: wrapper(qc),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current.length).toBe(2);
    // Sorted desc — A (10:00) before B (09:00)
    expect(result.current[0]!.id).toBe('notif-0001');
    expect(result.current[1]!.id).toBe('notif-0002');
  });

  it('@read-only filters by userId client-side', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/notifications`, () =>
        HttpResponse.json({ items: [ITEM_A, ITEM_B], total: 2 }),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useNotificationList('user-999', emptyFilter()), {
      wrapper: wrapper(qc),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Both items belong to user-001, not user-999 → empty
    expect(result.current.length).toBe(0);
  });

  it('@read-only applies client-side category filter for multiple values', async () => {
    const ITEM_C = { ...ITEM_A, id: 'notif-0003', category: 'audit' };
    server.use(
      http.get(`/api/v1/t/${TENANT}/notifications`, () =>
        HttpResponse.json({ items: [ITEM_A, ITEM_B, ITEM_C], total: 3 }),
      ),
    );
    const qc = makeQueryClient();
    const filter = { ...emptyFilter(), categories: ['system', 'audit'] };
    const { result } = renderHook(() => useNotificationList('user-001', filter), {
      wrapper: wrapper(qc),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current.every((n) => ['system', 'audit'].includes(n.category))).toBe(true);
    expect(result.current.length).toBe(2);
  });

  it('@read-only search is case-insensitive against title+body', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/notifications`, () =>
        HttpResponse.json({ items: [ITEM_A, ITEM_B], total: 2 }),
      ),
    );
    const qc = makeQueryClient();
    const filter = { ...emptyFilter(), search: 'expiring' };
    const { result } = renderHook(() => useNotificationList('user-001', filter), {
      wrapper: wrapper(qc),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current.length).toBe(1);
    expect(result.current[0]!.id).toBe('notif-0001');
  });

  it('@read-only sends ?archived=false by default', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`/api/v1/t/${TENANT}/notifications`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );
    const qc = makeQueryClient();
    renderHook(() => useNotificationList('user-001', emptyFilter()), { wrapper: wrapper(qc) });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(capturedUrl).toContain('archived=false');
  });

  it('@read-only maps daemon DTO fields to NotificationItem correctly', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/notifications`, () =>
        HttpResponse.json({ items: [ITEM_A], total: 1 }),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useNotificationList('user-001', emptyFilter()), {
      wrapper: wrapper(qc),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const item = result.current[0]!;
    expect(item.id).toBe('notif-0001');
    expect(item.user_id).toBe('user-001');
    expect(item.read_at).toBeNull();
    expect(item.archived_at).toBeNull();
    expect(item.read).toBe(false);
    expect(item.at).toBe(ITEM_A.occurredAt);
    expect(item.created_at).toBe(ITEM_A.occurredAt);
  });
});

// ─── useUnreadCount ───────────────────────────────────────────────────────────

describe('useUnreadCount', () => {
  it('@read-only returns the unreadCount from daemon', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/notifications/unread-count`, () =>
        HttpResponse.json({ unreadCount: 5 }),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useUnreadCount('user-001'), { wrapper: wrapper(qc) });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current).toBe(5);
  });

  it('@read-only returns 0 before data resolves', () => {
    const qc = makeQueryClient();
    const { result } = renderHook(() => useUnreadCount('user-001'), { wrapper: wrapper(qc) });
    expect(result.current).toBe(0);
  });
});

// ─── useNotificationDetail ────────────────────────────────────────────────────

describe('useNotificationDetail', () => {
  it('@read-only returns the notification mapped from daemon DTO', async () => {
    server.use(
      http.get(`/api/v1/t/${TENANT}/notifications/notif-0001`, () =>
        HttpResponse.json(ITEM_A),
      ),
    );
    const qc = makeQueryClient();
    const { result } = renderHook(() => useNotificationDetail('notif-0001'), {
      wrapper: wrapper(qc),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current?.id).toBe('notif-0001');
    expect(result.current?.title).toBe('API Key expiring');
  });
});

// ─── markRead ─────────────────────────────────────────────────────────────────

describe('markRead', () => {
  it('POSTs to /notifications/:id/read and returns updated item', async () => {
    const readAt = '2025-01-01T11:00:00.000Z';
    server.use(
      http.post(`/api/v1/t/${TENANT}/notifications/notif-0001/read`, () =>
        HttpResponse.json({ ...ITEM_A, readAt }),
      ),
    );
    const result = await markRead('notif-0001');
    expect(result?.id).toBe('notif-0001');
    expect(result?.read_at).toBe(readAt);
    expect(result?.read).toBe(true);
  });

  it('returns undefined when tenant cannot be resolved', async () => {
    window.history.replaceState(null, '', '/');
    const result = await markRead('notif-0001');
    expect(result).toBeUndefined();
    setTenantUrl();
  });
});

// ─── markAllRead ──────────────────────────────────────────────────────────────

describe('markAllRead', () => {
  it('POSTs to /notifications/read-all and returns count', async () => {
    server.use(
      http.post(`/api/v1/t/${TENANT}/notifications/read-all`, () =>
        HttpResponse.json({ count: 7 }),
      ),
    );
    const count = await markAllRead('user-001');
    expect(count).toBe(7);
  });
});

// ─── archive + unarchive ──────────────────────────────────────────────────────

describe('archive', () => {
  it('POSTs to /notifications/:id/archive and returns updated item', async () => {
    const archivedAt = '2025-01-01T12:00:00.000Z';
    server.use(
      http.post(`/api/v1/t/${TENANT}/notifications/notif-0001/archive`, () =>
        HttpResponse.json({ ...ITEM_A, archivedAt }),
      ),
    );
    const result = await archive('notif-0001');
    expect(result?.archived_at).toBe(archivedAt);
  });
});

describe('unarchive', () => {
  it('POSTs to /notifications/:id/unarchive and returns updated item', async () => {
    server.use(
      http.post(`/api/v1/t/${TENANT}/notifications/notif-0001/unarchive`, () =>
        HttpResponse.json({ ...ITEM_B, archivedAt: null, readAt: null }),
      ),
    );
    const result = await unarchive('notif-0001');
    expect(result?.archived_at).toBeNull();
  });
});

// ─── subscribeInboxStream ─────────────────────────────────────────────────────

describe('subscribeInboxStream', () => {
  it('delegates to subscribeSSE with the correct topic', () => {
    const onDelta = vi.fn();
    subscribeInboxStream(TENANT, onDelta);
    expect(subscribeSSE).toHaveBeenCalledWith(
      `t/${TENANT}/notifications/stream`,
      expect.any(Function),
    );
  });

  it('resolves tenant from URL when called with a userId (legacy compat)', () => {
    const onDelta = vi.fn();
    subscribeInboxStream('user-0001', onDelta);
    // Should still call subscribeSSE with the URL-resolved tenant
    expect(subscribeSSE).toHaveBeenCalledWith(
      `t/${TENANT}/notifications/stream`,
      expect.any(Function),
    );
  });

  it('returns an unsubscribe function', () => {
    const unsub = subscribeInboxStream(TENANT, vi.fn());
    expect(typeof unsub).toBe('function');
  });
});

// ─── emitNotification (client-side only) ─────────────────────────────────────

describe('emitNotification', () => {
  it('shows a Mantine toast with severity-appropriate color', () => {
    emitNotification({
      tenant_id: 'tenant-001',
      user_id: 'user-001',
      category: 'system',
      severity: 'error',
      title: 'Boom',
      body: 'Something broke',
    });
    expect(mantineNotifications.show).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mantineNotifications.show).mock.calls[0]![0]).toMatchObject({
      color: 'red',
      title: 'Boom',
      message: 'Something broke',
    });
  });

  it('returns a NotificationItem with correct fields', () => {
    const item = emitNotification({
      tenant_id: 'tenant-001',
      user_id: 'user-001',
      category: 'security',
      severity: 'warn',
      title: 'Check this',
      body: 'Something suspicious',
    });
    expect(item.read).toBe(false);
    expect(item.read_at).toBeNull();
    expect(item.archived_at).toBeNull();
    expect(item.category).toBe('security');
  });

  it('rejects invalid categories', () => {
    expect(() =>
      emitNotification({
        tenant_id: 'tenant-001',
        user_id: 'user-001',
        category: 'not-a-real-category',
        severity: 'info',
        title: 't',
        body: 'b',
      }),
    ).toThrow();
  });

  it('accepts plugin:<slug> categories', () => {
    const item = emitNotification({
      tenant_id: 'tenant-001',
      user_id: 'user-001',
      category: 'plugin:com.acme.billing',
      severity: 'warn',
      title: 'Plugin event',
      body: 'Invoice overdue',
    });
    expect(item.category).toBe('plugin:com.acme.billing');
  });

  it('preserves action field on emitted item', () => {
    const item = emitNotification({
      tenant_id: 'tenant-001',
      user_id: 'user-001',
      category: 'security',
      severity: 'warn',
      title: 'Check this',
      body: 'Click the link',
      action: { label: 'Open', href: '/t/acme/security' },
    });
    expect(item.action).toEqual({ label: 'Open', href: '/t/acme/security' });
    expect(item.action_url).toBe('/t/acme/security');
  });
});
