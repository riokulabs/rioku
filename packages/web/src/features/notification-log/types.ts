/**
 * Feature-local types for the notification-log (delivery log) feature.
 */
import type { ID, NotificationDeliveryLogEntry } from '@/api/resources';

export type { ID, NotificationDeliveryLogEntry };

export interface DeliveryLogFilter {
  /** Status filter. Empty = all. */
  statuses: NotificationDeliveryLogEntry['status'][];
  /** Channel filter. Empty = all. */
  channel_ids: ID[];
  /** Inclusive ISO lower bound on `last_attempted_at`. */
  date_from: string | null;
  /** Exclusive ISO upper bound on `last_attempted_at`. */
  date_to: string | null;
  /** Case-insensitive substring search against error_message + notification_id. */
  search: string;
}
