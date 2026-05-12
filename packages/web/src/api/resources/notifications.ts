// Types for the notifications resource surface.

import type { ID } from './common';

/**
 * Notification inbox entry.
 *
 * Categories:
 *   - 'system'        — infrastructure / health / policy notifications
 *   - 'security'      — session revokes, MFA, suspicious activity
 *   - 'audit'         — destructive actions, retention changes
 *   - 'plugin:<slug>' — emitted by a plugin via `host.notify`; `<slug>` must match
 *                       `^[a-z][a-z0-9-]*$`
 *
 * `tenant_id: null` denotes a cross-tenant / super-admin notification.
 * `read_at` and `archived_at` are ISO timestamps or null (unread / not-archived).
 *
 * Legacy callers used `read: boolean`, `created_at`, and `action_url`. Those
 * fields are preserved (as optional / derived) so legacy widget adapters keep
 * compiling.
 */
export interface NotificationItem {
  readonly id: ID;
  /** null = cross-tenant / super-admin broadcast. */
  readonly tenant_id: ID | null;
  readonly user_id: ID;
  category: string;
  severity: 'info' | 'warn' | 'error' | 'success';
  title: string;
  body: string;
  /** Optional "click here" action rendered as a button. */
  action?: { label: string; href: string };
  /** ISO timestamp or null if still unread. */
  read_at: string | null;
  /** ISO timestamp or null if not yet archived. */
  archived_at: string | null;
  /** ISO timestamp — when the notification was emitted. */
  readonly at: string;
  // ── Legacy fields (kept for back-compat with widget data-sources) ────────
  /** Legacy boolean mirror of `read_at !== null`. */
  read: boolean;
  /** Legacy alias of `at`. */
  readonly created_at: string;
  /** Legacy flat href — prefer `action.href`. */
  action_url?: string;
}
