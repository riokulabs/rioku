// Owned by Plan 06 (notifications) — types for the notification-channels resource surface.

import type { ID } from './common';

export interface NotificationChannel {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  kind: 'email' | 'slack' | 'webhook' | 'pagerduty' | 'teams' | 'sms';
  /** Per-kind config — validated by the kind-specific Zod schema. */
  config: Record<string, unknown>;
  enabled: boolean;
  readonly created_at: string;
}
