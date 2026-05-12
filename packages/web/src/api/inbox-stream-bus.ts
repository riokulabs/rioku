/**
 * Inbox-stream bus.
 *
 * Module-level EventTarget that carries newly-emitted notifications to
 * interested UI subscribers (e.g. the top-bar bell + inbox dropdown). Any
 * write that adds a notification via `emitNotification` is expected to also
 * publish on this bus via {@link publishInbox}.
 *
 * The emitted event is always `'inbox'`; `event.detail` is the
 * `NotificationItem`. Consumers filter by user_id / tenant_id themselves.
 */
import type { NotificationItem } from './resources';

/** Fixed topic string — only event name emitted on this bus. */
export const INBOX_STREAM_TOPIC = 'inbox';

/** Singleton EventTarget acting as the inbox-stream bus. */
export const inboxStreamBus = new EventTarget();

/** Narrowed event type for listeners. */
export type InboxStreamEvent = CustomEvent<NotificationItem>;

/**
 * Emit a notification to the bus. Consumers see it as a
 * `CustomEvent<NotificationItem>` whose `detail` is the item.
 */
export function publishInbox(item: NotificationItem): void {
  inboxStreamBus.dispatchEvent(new CustomEvent(INBOX_STREAM_TOPIC, { detail: item }));
}
