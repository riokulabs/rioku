/**
 * Feature-local types for the Notifications (inbox) feature.
 *
 * Mirrors the Plan 7 shape: filter criteria, emit input, listener signatures.
 */
import type { ID, NotificationItem } from '@/api/resources/types';

export type { ID, NotificationItem };

/**
 * Inbox filter — all arrays are inclusive OR. Empty arrays / null / empty
 * strings mean "no filter on this axis".
 */
export interface InboxFilter {
  /** Category list (e.g. 'system', 'security', 'plugin:com.rioku.slack'). */
  categories: string[];
  /** Severity bucket filter. */
  severities: NotificationItem['severity'][];
  /** If true, only surface items where `read_at === null`. */
  unreadOnly: boolean;
  /** If true, surface archived items; otherwise hide them. */
  includeArchived: boolean;
  /** Case-insensitive substring search against title + body. */
  search: string;
}

/** Callback fired when a new notification lands on the bus. */
export type InboxStreamListener = (item: NotificationItem) => void;

/** Optional action affixed to a notification. */
export interface NotificationAction {
  label: string;
  href: string;
}

/**
 * Input shape for {@link emitNotification}. Plan 7 §11.
 *
 * - `tenant_id: null` is allowed for cross-tenant / super-admin broadcasts.
 * - `category: 'system'` is reserved for the daemon / first-party callers;
 *   plugins must use `plugin:<slug>` (enforced in `host.notify`).
 */
export interface EmitNotificationInput {
  tenant_id: ID | null;
  user_id: ID;
  category: string;
  severity: NotificationItem['severity'];
  title: string;
  body: string;
  action?: NotificationAction;
}
