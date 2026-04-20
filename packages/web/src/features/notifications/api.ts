/**
 * Notifications inbox API — list, mark-read, archive, stream, emit.
 *
 * Backed by the Zustand mock store and the module-level inbox-stream bus.
 * Exports are shaped like Plan 5a (audit) so the in-browser UX can swap in a
 * real daemon-backed implementation with minimal churn.
 *
 * Permission model (Plan 7 §11):
 *   notification:read         list + detail
 *   notification:manage-own   mark-read/archive for own user_id
 *
 * `emitNotification` is the hot path for plugin + first-party emitters. It
 * writes to the store, dispatches the inbox-stream bus, and fires a Mantine
 * toast so the new notification is immediately visible. Plugins go through
 * `host.notify` (which enforces `plugin:<slug>` category and delegates here).
 */
import { useCallback, useMemo, useState } from 'react';
import { notifications as mantineNotifications } from '@mantine/notifications';

import { useMockStore } from '@/api/mock-store';
import {
  INBOX_STREAM_TOPIC,
  inboxStreamBus,
  publishInbox,
} from '@/api/inbox-stream-bus';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { AuditEntry, ID, NotificationItem } from '@/api/resources/types';

import {
  BUILT_IN_CATEGORIES,
  PLUGIN_CATEGORY_REGEX,
  emitNotificationInputSchema,
} from './schemas';
import type {
  EmitNotificationInput,
  InboxFilter,
  InboxStreamListener,
} from './types';

const nextNotifId = makeIdFactory('notif-emit');
const nextAuditId = makeIdFactory('audit-notif');

// ─── Filter matcher ──────────────────────────────────────────────────────────

function matchesFilter(
  item: NotificationItem,
  userId: ID,
  filter: InboxFilter,
): boolean {
  if (item.user_id !== userId) return false;

  if (!filter.includeArchived && item.archived_at !== null) return false;
  if (filter.unreadOnly && item.read_at !== null) return false;

  if (filter.categories.length > 0 && !filter.categories.includes(item.category)) {
    return false;
  }
  if (filter.severities.length > 0 && !filter.severities.includes(item.severity)) {
    return false;
  }

  const search = filter.search.trim().toLowerCase();
  if (search) {
    const hay = `${item.title} ${item.body}`.toLowerCase();
    if (!hay.includes(search)) return false;
  }

  return true;
}

function sortDesc(a: NotificationItem, b: NotificationItem): number {
  return a.at < b.at ? 1 : a.at > b.at ? -1 : 0;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * All notifications for `userId` matching `filter`, sorted desc by `at`.
 *
 * The Zustand selector only grabs the raw notifications record; filtering +
 * sorting happen outside the selector so the hook identity is stable when
 * unrelated store slices update.
 */
export function useNotificationList(
  userId: ID,
  filter: InboxFilter,
): NotificationItem[] {
  const notifications = useMockStore((s) => s.notifications);
  return useMemo(() => {
    const out: NotificationItem[] = [];
    for (const item of Object.values(notifications)) {
      if (matchesFilter(item, userId, filter)) out.push(item);
    }
    out.sort(sortDesc);
    return out;
  }, [notifications, userId, filter]);
}

/**
 * Unread + not-archived count for the given user. Drives the top-bar bell
 * badge. `0` is rendered as a hidden badge in the UI.
 */
export function useUnreadCount(userId: ID): number {
  const notifications = useMockStore((s) => s.notifications);
  return useMemo(() => {
    let n = 0;
    for (const item of Object.values(notifications)) {
      if (item.user_id !== userId) continue;
      if (item.read_at !== null) continue;
      if (item.archived_at !== null) continue;
      n += 1;
    }
    return n;
  }, [notifications, userId]);
}

/** Detail selector — returns the notification with id `notifId`, or undefined. */
export function useNotificationDetail(notifId: ID): NotificationItem | undefined {
  return useMockStore((s) => s.notifications[notifId]);
}

// ─── Infinite-list variant (mirrors audit API shape) ─────────────────────────

export interface NotificationListInfiniteResult {
  data: NotificationItem[];
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetching: boolean;
}

/**
 * Paginated variant of {@link useNotificationList}. Mirrors the TanStack
 * Query `useInfiniteQuery` surface so the UI can swap in a real network-
 * backed version in Stage 2 with no changes.
 */
export function useNotificationListInfinite(
  userId: ID,
  filter: InboxFilter,
  pageSize: number,
): NotificationListInfiniteResult {
  const full = useNotificationList(userId, filter);
  const [pages, setPages] = useState(1);

  const currentSlice = useMemo(
    () => full.slice(0, pages * pageSize),
    [full, pages, pageSize],
  );

  const hasNextPage = currentSlice.length < full.length;

  const fetchNextPage = useCallback(() => {
    setPages((p) => p + 1);
  }, []);

  return {
    data: currentSlice,
    fetchNextPage,
    hasNextPage,
    isFetching: false,
  };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Mark a single notification read. Sets `read_at` to now; no-ops if the
 * notification is already read or does not exist. Emits an audit entry
 * (tier: read) so the audit log reflects inbox activity, and fires a host
 * event for plugin consumers.
 */
export async function markRead(id: ID): Promise<NotificationItem | undefined> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.notifications[id];
  if (!current) return undefined;
  if (current.read_at !== null) return current;

  const now = new Date().toISOString();
  const next: NotificationItem = {
    ...current,
    read_at: now,
    read: true,
  };

  useMockStore.setState((s) => ({
    notifications: {
      ...s.notifications,
      [id]: next,
    },
  }));

  const entry: AuditEntry = {
    id: nextAuditId(),
    tenant_id: current.tenant_id ?? 'global',
    actor_id: state.currentUserId ?? current.user_id,
    action: 'notification.read',
    resource_type: 'notification',
    resource_id: id,
    outcome: 'success',
    at: now,
    tier: 'read',
  };
  state.appendAudit(entry);

  emitHostEvent('notification:read', { notification_id: id });

  return next;
}

/**
 * Mark every unread + not-archived notification for `userId` as read in a
 * single atomic setState call. Plan 7 explicitly requires multi-entity
 * atomicity here — Plans 2 + 6 taught us that per-item setState in a loop
 * tears the UI.
 */
export async function markAllRead(userId: ID): Promise<number> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const now = new Date().toISOString();

  let count = 0;
  const nextMap: Record<ID, NotificationItem> = { ...state.notifications };
  for (const [id, item] of Object.entries(state.notifications)) {
    if (item.user_id !== userId) continue;
    if (item.read_at !== null) continue;
    if (item.archived_at !== null) continue;
    nextMap[id] = { ...item, read_at: now, read: true };
    count += 1;
  }

  if (count === 0) return 0;

  useMockStore.setState(() => ({ notifications: nextMap }));

  const entry: AuditEntry = {
    id: nextAuditId(),
    tenant_id: state.currentTenantId ?? 'global',
    actor_id: state.currentUserId ?? userId,
    action: 'notification.mark_all_read',
    resource_type: 'notification',
    resource_id: userId,
    outcome: 'success',
    at: now,
    tier: 'write',
    payload: { count },
  };
  state.appendAudit(entry);

  emitHostEvent('notification:mark-all-read', { user_id: userId, count });

  return count;
}

/**
 * Archive a notification. Sets `archived_at` to now; no-ops if already
 * archived or missing.
 */
export async function archive(id: ID): Promise<NotificationItem | undefined> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.notifications[id];
  if (!current) return undefined;
  if (current.archived_at !== null) return current;

  const now = new Date().toISOString();
  const next: NotificationItem = { ...current, archived_at: now };

  useMockStore.setState((s) => ({
    notifications: {
      ...s.notifications,
      [id]: next,
    },
  }));

  const entry: AuditEntry = {
    id: nextAuditId(),
    tenant_id: current.tenant_id ?? 'global',
    actor_id: state.currentUserId ?? current.user_id,
    action: 'notification.archive',
    resource_type: 'notification',
    resource_id: id,
    outcome: 'success',
    at: now,
    tier: 'write',
  };
  state.appendAudit(entry);

  emitHostEvent('notification:archived', { notification_id: id });

  return next;
}

/** Unarchive a notification — clears `archived_at`. */
export async function unarchive(id: ID): Promise<NotificationItem | undefined> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.notifications[id];
  if (!current) return undefined;
  if (current.archived_at === null) return current;

  const now = new Date().toISOString();
  const next: NotificationItem = { ...current, archived_at: null };

  useMockStore.setState((s) => ({
    notifications: {
      ...s.notifications,
      [id]: next,
    },
  }));

  const entry: AuditEntry = {
    id: nextAuditId(),
    tenant_id: current.tenant_id ?? 'global',
    actor_id: state.currentUserId ?? current.user_id,
    action: 'notification.unarchive',
    resource_type: 'notification',
    resource_id: id,
    outcome: 'success',
    at: now,
    tier: 'write',
  };
  state.appendAudit(entry);

  emitHostEvent('notification:unarchived', { notification_id: id });

  return next;
}

// ─── Streaming tail ──────────────────────────────────────────────────────────

/**
 * Subscribe to newly-emitted notifications for `userId`. Fires `onNotification`
 * for each `publishInbox` call whose `user_id` matches. Returns an unsubscribe
 * function.
 *
 * Stage 2 replaces this with a real SSE subscription; the signature stays
 * identical.
 */
export function subscribeInboxStream(
  userId: ID,
  onNotification: InboxStreamListener,
): () => void {
  const handler = (e: Event): void => {
    const detail = (e as CustomEvent<NotificationItem>).detail;
    if (detail.user_id !== userId) return;
    onNotification(detail);
  };
  inboxStreamBus.addEventListener(INBOX_STREAM_TOPIC, handler);
  return () => {
    inboxStreamBus.removeEventListener(INBOX_STREAM_TOPIC, handler);
  };
}

// ─── Emit ─────────────────────────────────────────────────────────────────────

function severityToToastColor(severity: NotificationItem['severity']): string {
  switch (severity) {
    case 'error':
      return 'red';
    case 'warn':
      return 'orange';
    case 'success':
      return 'green';
    case 'info':
    default:
      return 'blue';
  }
}

/**
 * Validate that `category` is either a built-in bucket or a well-formed
 * `plugin:<slug>` identifier. Throws on mismatch.
 *
 * Note: Stage 1 does NOT enforce that `category: 'system'` only comes from
 * system-level callers — in the daemon this check belongs at the auth layer.
 * Plugin code MUST go through `host.notify`, which rejects any non-`plugin:*`
 * category before it reaches here.
 */
function validateCategory(category: string): void {
  if (BUILT_IN_CATEGORIES.includes(category as (typeof BUILT_IN_CATEGORIES)[number])) {
    return;
  }
  if (PLUGIN_CATEGORY_REGEX.test(category)) {
    return;
  }
  throw new Error(
    `Invalid notification category "${category}": must be one of ${BUILT_IN_CATEGORIES.join(' | ')} or match plugin:<slug>.`,
  );
}

/**
 * Emit a notification synchronously.
 *
 *   1. Validates the input shape + category
 *   2. Writes a new NotificationItem to the mock store
 *   3. Publishes on the inbox-stream bus so open dropdowns update live
 *   4. Fires a Mantine toast with severity-appropriate color
 *   5. Emits a `notification:emitted` host event for plugin consumers
 *
 * This is called by `host.notify` (plugin surface) and by first-party
 * features that want to push into the inbox (e.g., security alerts).
 */
export function emitNotification(input: EmitNotificationInput): NotificationItem {
  // Schema validation catches shape errors; `validateCategory` gives a better
  // error message for the category-specific rule.
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
    ...(parsed.action ? { action: parsed.action } : {}),
    read_at: null,
    archived_at: null,
    at: now,
    read: false,
    created_at: now,
    ...(parsed.action ? { action_url: parsed.action.href } : {}),
  };

  useMockStore.setState((s) => ({
    notifications: {
      ...s.notifications,
      [item.id]: item,
    },
  }));

  publishInbox(item);

  // Mantine toast — stays visible long enough to click through. Error toasts
  // get the longest autoClose; info/success stay shorter.
  mantineNotifications.show({
    color: severityToToastColor(item.severity),
    title: item.title,
    message: item.body,
    autoClose:
      item.severity === 'error'
        ? 8000
        : item.severity === 'warn'
          ? 6000
          : 4000,
  });

  emitHostEvent('notification:emitted', { notification_id: item.id, category: item.category });

  return item;
}
