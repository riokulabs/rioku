/**
 * Notifications inbox API — list, mark-read, archive, stream.
 *
 * Stage-2: backed by daemon REST endpoints + SSE stream.
 *
 * Permission model (Plan 7 §11):
 *   notification:read         list + detail
 *   notification:manage-own   mark-read/archive for own user_id
 *
 * Daemon delivers only the authed user's notifications so the `userId`
 * parameter is used client-side for filtering (legacy compat) and for
 * the `markAllRead` response count.
 *
 * SSE stream subscribes to the per-tenant topic via `subscribeSSE`.
 * Each event is a lightweight `NotificationStreamDelta`; receipt invalidates
 * the React Query inbox cache so the list refetches silently.
 *
 * `emitNotification` is the client-side hot-path for plugin + first-party
 * emitters (immediate toast + host event). It does NOT persist to daemon.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications as mantineNotifications } from '@mantine/notifications';

import { customFetch } from '@/api/mutator';
import { subscribeSSE } from '@/api/sse-client';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { ID, NotificationItem } from '@/api/resources';

import { BUILT_IN_CATEGORIES, PLUGIN_CATEGORY_REGEX, emitNotificationInputSchema } from './schemas';
import type { EmitNotificationInput, InboxFilter, InboxStreamListener } from './types';

const nextNotifId = makeIdFactory('notif-emit');

// ─── Tenant resolution ────────────────────────────────────────────────────────

/**
 * Resolve the current tenant slug from the URL path `/t/<slug>/...`.
 * Components that already know the tenant should pass it explicitly.
 */
export function resolveTenant(): string {
  if (typeof window !== 'undefined') {
    const m = /^\/t\/([^/]+)/.exec(window.location.pathname);
    if (m?.[1]) return m[1];
  }
  return '';
}

// ─── Response shapes from daemon ─────────────────────────────────────────────

interface DaemonNotificationItem {
  id: string;
  tenantId?: string | null;
  userId: string;
  category: string;
  severity: 'info' | 'warn' | 'error' | 'success';
  title: string;
  body: string;
  actionLink?: string | null;
  readAt?: string | null;
  archivedAt?: string | null;
  occurredAt: string;
}

interface ListResponse {
  items: DaemonNotificationItem[];
  total: number;
}

interface UnreadCountResponse {
  unreadCount: number;
}

// ─── DTO mapper ───────────────────────────────────────────────────────────────

function mapItem(d: DaemonNotificationItem): NotificationItem {
  return {
    id: d.id,
    tenant_id: d.tenantId ?? null,
    user_id: d.userId,
    category: d.category,
    severity: d.severity,
    title: d.title,
    body: d.body,
    ...(d.actionLink
      ? { action: { label: 'View', href: d.actionLink }, action_url: d.actionLink }
      : {}),
    read_at: d.readAt ?? null,
    archived_at: d.archivedAt ?? null,
    at: d.occurredAt,
    read: d.readAt != null,
    created_at: d.occurredAt,
  };
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const notificationKeys = {
  all: (tenant: string) => ['notifications', tenant] as const,
  list: (tenant: string, filter: InboxFilter) => ['notifications', tenant, 'list', filter] as const,
  unread: (tenant: string) => ['notifications', tenant, 'unread'] as const,
  detail: (tenant: string, id: string) => ['notifications', tenant, id] as const,
};

// ─── Filter → query params ────────────────────────────────────────────────────

function buildParams(filter: InboxFilter): Record<string, string> {
  const p: Record<string, string> = {};
  // Single-value filters pushed to server; multi-value done client-side.
  if (filter.categories.length === 1) p.category = filter.categories[0] ?? '';
  if (filter.severities.length === 1) p.severity = filter.severities[0] ?? '';
  if (filter.unreadOnly) p.read = 'false';
  if (!filter.includeArchived) p.archived = 'false';
  return p;
}

async function fetchNotificationList(
  tenant: string,
  filter: InboxFilter,
): Promise<NotificationItem[]> {
  const params = buildParams(filter);
  const qs = Object.keys(params).length > 0 ? '?' + new URLSearchParams(params).toString() : '';
  const data = await customFetch<ListResponse>({
    url: `/t/${tenant}/notifications${qs}`,
    method: 'GET',
  });
  let items = data.items.map(mapItem);

  // Client-side multi-value filtering (daemon only supports single values).
  if (filter.categories.length > 1) {
    items = items.filter((n) => filter.categories.includes(n.category));
  }
  if (filter.severities.length > 1) {
    items = items.filter((n) => filter.severities.includes(n.severity));
  }
  if (filter.search.trim()) {
    const q = filter.search.trim().toLowerCase();
    items = items.filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(q));
  }
  // Sort descending by `at`.
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return items;
}

// ─── Selectors (TanStack Query) ───────────────────────────────────────────────

/**
 * All notifications for the current user matching `filter`, sorted desc by `at`.
 * Daemon scopes to the authed user; `userId` is used for client-side filtering
 * (defense-in-depth + legacy compat).
 */
export function useNotificationList(userId: ID, filter: InboxFilter): NotificationItem[] {
  const tenant = resolveTenant();
  const { data } = useQuery({
    queryKey: notificationKeys.list(tenant, filter),
    queryFn: () => fetchNotificationList(tenant, filter),
    staleTime: 30_000,
    enabled: !!tenant,
  });
  return useMemo(() => (data ?? []).filter((n) => !userId || n.user_id === userId), [data, userId]);
}

/**
 * Unread + not-archived count for the top-bar bell badge.
 * `userId` retained for API compat; daemon uses session claims.
 */
export function useUnreadCount(_userId: ID): number {
  const tenant = resolveTenant();
  const { data } = useQuery({
    queryKey: notificationKeys.unread(tenant),
    queryFn: () =>
      customFetch<UnreadCountResponse>({
        url: `/t/${tenant}/notifications/unread-count`,
        method: 'GET',
      }),
    staleTime: 15_000,
    enabled: !!tenant,
  });
  return data?.unreadCount ?? 0;
}

/** Detail selector — returns the notification with id `notifId`, or undefined. */
export function useNotificationDetail(notifId: ID): NotificationItem | undefined {
  const tenant = resolveTenant();
  const { data } = useQuery({
    queryKey: notificationKeys.detail(tenant, notifId),
    queryFn: () =>
      customFetch<DaemonNotificationItem>({
        url: `/t/${tenant}/notifications/${notifId}`,
        method: 'GET',
      }),
    staleTime: 60_000,
    enabled: !!tenant && !!notifId,
  });
  return data ? mapItem(data) : undefined;
}

// ─── Infinite-list variant ────────────────────────────────────────────────────

export interface NotificationListInfiniteResult {
  data: NotificationItem[];
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetching: boolean;
}

/**
 * Paginated variant of {@link useNotificationList}. Daemon returns up to 200
 * items; we slice client-side to preserve the TanStack Query surface expected
 * by the UI.
 */
export function useNotificationListInfinite(
  userId: ID,
  filter: InboxFilter,
  pageSize: number,
): NotificationListInfiniteResult {
  const full = useNotificationList(userId, filter);
  const [pages, setPages] = useState(1);
  const currentSlice = useMemo(() => full.slice(0, pages * pageSize), [full, pages, pageSize]);
  const hasNextPage = currentSlice.length < full.length;
  const fetchNextPage = useCallback(() => {
    setPages((p) => p + 1);
  }, []);
  return { data: currentSlice, fetchNextPage, hasNextPage, isFetching: false };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Mark a single notification read.
 * Returns the updated item or undefined on missing / error.
 */
export async function markRead(id: ID): Promise<NotificationItem | undefined> {
  const tenant = resolveTenant();
  if (!tenant) return undefined;
  try {
    const data = await customFetch<DaemonNotificationItem>({
      url: `/t/${tenant}/notifications/${id}/read`,
      method: 'POST',
    });
    emitHostEvent('notification:read', { notification_id: id });
    return mapItem(data);
  } catch {
    return undefined;
  }
}

/**
 * Mark a single notification unread (inverse of {@link markRead}).
 *
 * Daemon returns 204 No Content on success; the frontend resolves to
 * `true` on success and `false` on any failure (network, 404, 403).
 */
export async function markUnread(id: ID): Promise<boolean> {
  const tenant = resolveTenant();
  if (!tenant) return false;
  try {
    await customFetch<unknown>({
      url: `/t/${tenant}/notifications/${id}/unread`,
      method: 'POST',
    });
    emitHostEvent('notification:unread', { notification_id: id });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark every unread + not-archived notification read.
 * Returns the count of items marked.
 * `userId` retained for API compat; daemon uses session claims.
 */
export async function markAllRead(_userId: ID): Promise<number> {
  const tenant = resolveTenant();
  if (!tenant) return 0;
  const data = await customFetch<{ count: number }>({
    url: `/t/${tenant}/notifications/read-all`,
    method: 'POST',
  });
  emitHostEvent('notification:mark-all-read', { tenant });
  return data.count;
}

/**
 * Archive a notification.
 * Returns the updated item or undefined on missing / error.
 */
export async function archive(id: ID): Promise<NotificationItem | undefined> {
  const tenant = resolveTenant();
  if (!tenant) return undefined;
  try {
    const data = await customFetch<DaemonNotificationItem>({
      url: `/t/${tenant}/notifications/${id}/archive`,
      method: 'POST',
    });
    emitHostEvent('notification:archived', { notification_id: id });
    return mapItem(data);
  } catch {
    return undefined;
  }
}

/**
 * Unarchive a notification.
 * Returns the updated item or undefined on missing / error.
 */
export async function unarchive(id: ID): Promise<NotificationItem | undefined> {
  const tenant = resolveTenant();
  if (!tenant) return undefined;
  try {
    const data = await customFetch<DaemonNotificationItem>({
      url: `/t/${tenant}/notifications/${id}/unarchive`,
      method: 'POST',
    });
    emitHostEvent('notification:unarchived', { notification_id: id });
    return mapItem(data);
  } catch {
    return undefined;
  }
}

// ─── SSE stream ───────────────────────────────────────────────────────────────

/** Lightweight SSE delta sent by the daemon stream endpoint. */
export interface NotificationStreamDelta {
  id: string;
  category: string;
  severity: string;
  title: string;
  createdAt: string;
}

/**
 * Subscribe to the live notification stream for a tenant via `subscribeSSE`.
 *
 * Each SSE event is a lightweight `NotificationStreamDelta`. Callers should
 * use this to drive cache invalidation (see `useInboxStream`).
 *
 * Returns an unsubscribe function.
 *
 * Stage-1 callers used `subscribeInboxStream(userId, listener)` with the
 * mock EventTarget bus. Stage-2 signature changes to `(tenant, onDelta)`.
 * The old `userId` param is retired — daemon scopes to the authed user.
 */
export function subscribeInboxStream(
  tenantOrUserId: string,
  onDelta: ((delta: NotificationStreamDelta) => void) | InboxStreamListener,
): () => void {
  // Heuristic: if the value looks like a userId (matches the mock-store prefix
  // 'user-' or is not a tenant slug) we resolve the tenant from the URL
  // instead. This keeps stage-1 call sites working without modification.
  const tenant = tenantOrUserId.startsWith('user-') ? resolveTenant() : tenantOrUserId;
  if (!tenant) {
    return () => {
      /* no-op: no tenant in URL, nothing to unsubscribe */
    };
  }
  const topic = `t/${tenant}/notifications/stream`;
  return subscribeSSE(topic, (detail) => {
    // The legacy InboxStreamListener expected a NotificationItem; SSE now
    // sends a NotificationStreamDelta. Call onDelta with the delta directly —
    // callers that used the old signature will receive a partial object.
    // The inbox-dropdown and top-bar components use the hook instead.
    (onDelta as (d: NotificationStreamDelta) => void)(detail as NotificationStreamDelta);
  });
}

/**
 * React hook that subscribes to the inbox SSE stream and invalidates the
 * TanStack Query inbox cache when new notifications arrive.
 *
 * Place at the top-level of the inbox page or the app shell so the bell badge
 * and inbox list stay live without polling.
 */
export function useInboxStream(
  tenant: string,
  onDelta?: (delta: NotificationStreamDelta) => void,
): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!tenant) return;
    const unsub = subscribeInboxStream(tenant, (delta: NotificationStreamDelta) => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all(tenant) });
      onDelta?.(delta);
    });
    return unsub;
  }, [tenant, qc, onDelta]);
}

// ─── emitNotification (client-side toast + host event) ────────────────────────

/**
 * Validate category; throws on mismatch.
 */
function validateCategory(category: string): void {
  if (BUILT_IN_CATEGORIES.includes(category as (typeof BUILT_IN_CATEGORIES)[number])) return;
  if (PLUGIN_CATEGORY_REGEX.test(category)) return;
  throw new Error(
    `Invalid notification category "${category}": must be one of ${BUILT_IN_CATEGORIES.join(' | ')} or match plugin:<slug>.`,
  );
}

function severityToToastColor(severity: NotificationItem['severity']): string {
  switch (severity) {
    case 'error':
      return 'red';
    case 'warn':
      return 'orange';
    case 'success':
      return 'green';
    default:
      return 'blue';
  }
}

/**
 * Emit a client-side notification (immediate toast + host event).
 *
 * This does NOT persist to the daemon — use it for immediate in-browser
 * feedback from plugins and first-party features. The daemon-side dispatcher
 * handles persistent notification routing.
 *
 * Kept for plugin compatibility: `host.notify` → `emitNotification`.
 */
export function emitNotification(input: EmitNotificationInput): NotificationItem {
  const parsed = emitNotificationInputSchema.parse(input);
  validateCategory(parsed.category);

  const now = new Date().toISOString();
  const item: NotificationItem = {
    id: nextNotifId(),
    tenant_id: parsed.tenant_id,
    user_id: parsed.user_id,
    category: parsed.category,
    severity: parsed.severity,
    title: parsed.title,
    body: parsed.body,
    ...(parsed.action ? { action: parsed.action, action_url: parsed.action.href } : {}),
    read_at: null,
    archived_at: null,
    at: now,
    read: false,
    created_at: now,
  };

  mantineNotifications.show({
    color: severityToToastColor(item.severity),
    title: item.title,
    message: item.body,
    autoClose: item.severity === 'error' ? 8000 : item.severity === 'warn' ? 6000 : 4000,
  });

  emitHostEvent('notification:emitted', { notification_id: item.id, category: item.category });

  return item;
}
