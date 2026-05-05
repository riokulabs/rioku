// Owned by Plan 06 (notifications) — types for the notification-log resource surface.

import type { ID } from './common';

export interface NotificationDeliveryLogEntry {
  readonly id: ID;
  readonly tenant_id: ID;
  readonly channel_id: ID;
  readonly notification_id: ID;
  status: 'delivered' | 'retrying' | 'failed' | 'pending';
  attempts: number;
  error_message?: string;
  readonly first_attempted_at: string;
  last_attempted_at: string;
  // ── Legacy Plan 1 fields (back-compat) ─────────────────────────────────
  /** Legacy alias of `last_attempted_at`. */
  attempted_at: string;
  /** Legacy alias of `error_message`. */
  error?: string;
}
