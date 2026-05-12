// Types for the notification-routing resource surface.

import type { ID } from './common';

export interface NotificationRoutingRule {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  /** Category + severity glob (e.g. `'security.*'`, `'audit.destructive'`). */
  event_filter: string;
  channel_ids: ID[];
  enabled: boolean;
  /** Evaluation order — lower runs first. Dense ordering is maintained on reorder. */
  order_hint: number;
  readonly created_at: string;
}

/**
 * Tenant-scoped notification configuration.
 * Controls master on/off, opt-in mode, plugin category registration,
 * channel priority, and retry behaviour.
 */
export interface TenantNotificationConfig {
  readonly tenant_id: ID;
  /** Master kill switch — when false, no notifications are dispatched. */
  enabled: boolean;
  /** Whether users must opt-in per category (true) or opt-out (false). */
  opt_in_mode: 'opt-in' | 'opt-out';
  /** Allow installed plugins to register their own notification categories. */
  plugins_can_register_categories: boolean;
  /**
   * Ordered list of channel IDs that define delivery priority when multiple
   * routing rules match the same event. First channel in the list is tried first.
   */
  default_channel_priority: ID[];
  /** Maximum number of delivery retries before a log entry is marked `failed`. 0–10. */
  max_retries: number;
  /** Base back-off interval between retries, in seconds. 1–3600. */
  retry_backoff_seconds: number;
  readonly updated_at: string;
}
