/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Tests for the notifications (inbox) API — list selectors, unread count,
 * mark-read / mark-all-read / archive / unarchive, streaming bus, emit.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';

vi.mock('@mantine/notifications', () => ({
  notifications: {
    show: vi.fn(),
  },
}));

import { notifications as mantineNotifications } from '@mantine/notifications';

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

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  vi.mocked(mantineNotifications.show).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function emptyFilter(): InboxFilter {
  return {
    categories: [],
    severities: [],
    unreadOnly: false,
    includeArchived: false,
    search: '',
  };
}

function firstUserWithNotifications(): string {
  const s = useMockStore.getState();
  const byUser = new Map<string, number>();
  for (const n of Object.values(s.notifications)) {
    byUser.set(n.user_id, (byUser.get(n.user_id) ?? 0) + 1);
  }
  const [userId] = [...byUser.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return userId;
}

describe('useNotificationList', () => {
  it('returns notifications for the user sorted desc by at', () => {
    const userId = firstUserWithNotifications();
    const { result } = renderHook(() => useNotificationList(userId, emptyFilter()));
    expect(result.current.length).toBeGreaterThan(0);
    for (const item of result.current) expect(item.user_id).toBe(userId);
    for (let i = 1; i < result.current.length; i++) {
      expect(result.current[i - 1]!.at >= result.current[i]!.at).toBe(true);
    }
  });

  it('excludes archived by default', () => {
    const userId = firstUserWithNotifications();
    const { result } = renderHook(() => useNotificationList(userId, emptyFilter()));
    for (const item of result.current) expect(item.archived_at).toBeNull();
  });

  it('unreadOnly filters out read items', () => {
    const userId = firstUserWithNotifications();
    const filter: InboxFilter = { ...emptyFilter(), unreadOnly: true };
    const { result } = renderHook(() => useNotificationList(userId, filter));
    for (const item of result.current) expect(item.read_at).toBeNull();
  });

  it('category + severity filters combine (AND across axes)', () => {
    const userId = firstUserWithNotifications();
    const filter: InboxFilter = {
      ...emptyFilter(),
      categories: ['system'],
      severities: ['info'],
    };
    const { result } = renderHook(() => useNotificationList(userId, filter));
    for (const item of result.current) {
      expect(item.category).toBe('system');
      expect(item.severity).toBe('info');
    }
  });

  it('search is case-insensitive against title+body', () => {
    const userId = firstUserWithNotifications();
    const filter: InboxFilter = { ...emptyFilter(), search: 'expiring' };
    const { result } = renderHook(() => useNotificationList(userId, filter));
    for (const item of result.current) {
      const hay = `${item.title} ${item.body}`.toLowerCase();
      expect(hay).toContain('expiring');
    }
  });
});

describe('useUnreadCount', () => {
  it('counts only unread + non-archived for the user', () => {
    const userId = firstUserWithNotifications();
    const { result } = renderHook(() => useUnreadCount(userId));
    const s = useMockStore.getState();
    let expected = 0;
    for (const n of Object.values(s.notifications)) {
      if (n.user_id !== userId) continue;
      if (n.read_at !== null) continue;
      if (n.archived_at !== null) continue;
      expected += 1;
    }
    expect(result.current).toBe(expected);
  });
});

describe('markRead', () => {
  it('sets read_at and legacy read=true; is idempotent', async () => {
    const userId = firstUserWithNotifications();
    const unread = Object.values(useMockStore.getState().notifications).find(
      (n) => n.user_id === userId && n.read_at === null && n.archived_at === null,
    );
    expect(unread).toBeDefined();
    const next = await markRead(unread!.id);
    expect(next?.read_at).not.toBeNull();
    expect(next?.read).toBe(true);

    const stored = useMockStore.getState().notifications[unread!.id];
    expect(stored?.read_at).toBe(next?.read_at);

    const again = await markRead(unread!.id);
    expect(again?.read_at).toBe(next?.read_at);
  });

  it('no-ops on missing id', async () => {
    const next = await markRead('notif-does-not-exist');
    expect(next).toBeUndefined();
  });
});

describe('markAllRead', () => {
  it('flips every unread+non-archived item for the user in one setState', async () => {
    const userId = firstUserWithNotifications();
    const before = useMockStore.getState();
    const expected = Object.values(before.notifications).filter(
      (n) => n.user_id === userId && n.read_at === null && n.archived_at === null,
    ).length;

    const count = await markAllRead(userId);
    expect(count).toBe(expected);

    const after = useMockStore.getState();
    const remaining = Object.values(after.notifications).filter(
      (n) => n.user_id === userId && n.read_at === null && n.archived_at === null,
    );
    expect(remaining.length).toBe(0);
  });
});

describe('archive + unarchive', () => {
  it('sets and clears archived_at', async () => {
    const userId = firstUserWithNotifications();
    const target = Object.values(useMockStore.getState().notifications).find(
      (n) => n.user_id === userId && n.archived_at === null,
    );
    expect(target).toBeDefined();

    const archived = await archive(target!.id);
    expect(archived?.archived_at).not.toBeNull();

    const restored = await unarchive(target!.id);
    expect(restored?.archived_at).toBeNull();
  });
});

describe('useNotificationDetail', () => {
  it('returns the stored notification', () => {
    const [id] = Object.keys(useMockStore.getState().notifications);
    const { result } = renderHook(() => useNotificationDetail(id!));
    expect(result.current?.id).toBe(id);
  });
});

describe('subscribeInboxStream + emitNotification', () => {
  it('delivers emitted notifications to the matching user only', () => {
    const userA = 'user-0001';
    const userB = 'user-0002';
    const seen: string[] = [];
    const unsub = subscribeInboxStream(userA, (n) => {
      seen.push(n.id);
    });

    const emitted = emitNotification({
      tenant_id: 'tenant-0001',
      user_id: userA,
      category: 'system',
      severity: 'info',
      title: 'Hello',
      body: 'World',
    });

    // Emit for B — should not show up in A's subscriber
    emitNotification({
      tenant_id: 'tenant-0001',
      user_id: userB,
      category: 'security',
      severity: 'warn',
      title: 'Another',
      body: 'Body',
    });

    expect(seen).toEqual([emitted.id]);
    unsub();
  });

  it('fires a Mantine toast with severity-appropriate color', () => {
    emitNotification({
      tenant_id: null,
      user_id: 'user-0001',
      category: 'audit',
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

  it('rejects invalid categories', () => {
    expect(() =>
      emitNotification({
        tenant_id: 'tenant-0001',
        user_id: 'user-0001',
        category: 'not-a-real-category',
        severity: 'info',
        title: 't',
        body: 'b',
      }),
    ).toThrow();
  });

  it('accepts plugin:<slug> categories', () => {
    const item = emitNotification({
      tenant_id: 'tenant-0001',
      user_id: 'user-0001',
      category: 'plugin:com.acme.billing',
      severity: 'warn',
      title: 'Plugin event',
      body: 'Invoice overdue',
    });
    expect(item.category).toBe('plugin:com.acme.billing');
  });

  it('preserves action field on emitted item', () => {
    const item = emitNotification({
      tenant_id: 'tenant-0001',
      user_id: 'user-0001',
      category: 'security',
      severity: 'warn',
      title: 'Check this',
      body: 'Click the link',
      action: { label: 'Open', href: '/t/acme/security' },
    });
    expect(item.action).toEqual({ label: 'Open', href: '/t/acme/security' });
    expect(item.action_url).toBe('/t/acme/security');
  });

  it('the new notification appears in useNotificationList immediately', () => {
    const userId = 'user-0001';
    const { result, rerender } = renderHook(() =>
      useNotificationList(userId, emptyFilter()),
    );
    const before = result.current.length;
    act(() => {
      emitNotification({
        tenant_id: 'tenant-0001',
        user_id: userId,
        category: 'system',
        severity: 'info',
        title: 'Hello live',
        body: 'World',
      });
    });
    rerender();
    expect(result.current.length).toBe(before + 1);
    expect(result.current[0]?.title).toBe('Hello live');
  });
});
