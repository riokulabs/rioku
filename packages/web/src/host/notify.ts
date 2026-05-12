/**
 * Plugin notification emitter.
 *
 * Plugins call `emitPluginNotification(...)` to push notifications into the
 * in-app inbox. The function validates the category naming convention
 * (must start with `plugin:<pluginName>`) and delegates to an injected
 * backend. First-party boot code (`app/providers.tsx`) supplies a backend
 * that:
 *
 *   1. Writes the notification through `features/notifications.emitNotification`
 *      so it lands in the Zustand mock store and the inbox bell updates.
 *   2. Dispatches on the inbox-stream bus so open dropdowns react live.
 *   3. Fires a Mantine toast.
 *
 * BOUNDARY NOTE: `host/` cannot import `api/` or `features/` directly (the
 * ESLint `boundaries` plugin rejects it). Dependency injection keeps this
 * module dependency-free — `setNotifyBackend` is called once from the
 * providers tree at mount time, and `emitPluginNotification` forwards to
 * whatever was wired.
 */

import { publishMock } from '@/api/mock-sse';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationSeverity = 'info' | 'warn' | 'error' | 'success';

export interface PluginNotificationAction {
  label: string;
  href: string;
}

/**
 * Input shape plugins pass to `host.notify.emit(...)`.
 *
 * `category` MUST start with `plugin:<pluginName>` — enforced below. This
 * blocks plugins from spoofing `system:` / `security:` / `audit:` categories.
 */
export interface PluginNotificationInput {
  pluginName: string;
  category: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  /** Optional tenant scope. Defaults to the current tenant at write time. */
  tenant?: string;
  /** Optional explicit recipient. Defaults to the current user at write time. */
  user?: string;
  /** Optional click-through action rendered in the inbox entry. */
  action?: PluginNotificationAction;
}

/**
 * Backend contract the first-party boot code wires up. `write` receives a
 * fully-enriched entry (id + createdAt assigned by this module); the
 * provider's implementation forwards to `features/notifications.emitNotification`
 * so the inbox + toast fire together.
 */
export interface NotifyBackend {
  write(input: PluginNotificationInput & { id: string; createdAt: string }): void;
}

// ─── Injected backend ─────────────────────────────────────────────────────────

let _backend: NotifyBackend | null = null;

/**
 * Wire the notification backend. Called once from `app/providers.tsx` after
 * the mock store is ready. Idempotent — a later call replaces the backend
 * reference.
 */
export function setNotifyBackend(backend: NotifyBackend): void {
  _backend = backend;
}

// ─── Counter for notification ids ─────────────────────────────────────────────

let _notifCounter = 0;

function nextNotifId(pluginName: string): string {
  _notifCounter += 1;
  return `notif-plugin-${pluginName}-${String(_notifCounter).padStart(4, '0')}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Emit a plugin notification.
 *
 * Validates:
 *   - `category` must start with `plugin:<pluginName>`. This is
 *     enforced at the entry point so plugins cannot write to built-in
 *     category buckets (system / security / audit) even if the category
 *     schema downstream would accept `plugin:<othername>`.
 *
 * Writes via the injected backend, which in turn calls the inbox
 * `emitNotification` helper. Also publishes a `notifications:new` event on
 * the legacy mock-SSE bus for any listener that hasn't migrated to
 * `subscribeInboxStream` yet.
 *
 * @throws if `category` does not start with the expected prefix.
 * @throws if the notify backend has not been wired.
 */
export function emitPluginNotification(input: PluginNotificationInput): void {
  const expectedPrefix = `plugin:${input.pluginName}`;
  const valid =
    input.category === expectedPrefix ||
    input.category.startsWith(`${expectedPrefix}:`) ||
    input.category.startsWith(`${expectedPrefix}.`);
  if (!valid) {
    throw new Error(
      `Plugin notification category must start with "${expectedPrefix}", got "${input.category}".`,
    );
  }

  if (!_backend) {
    throw new Error(
      '[host.notify] Notify backend not wired. Call setNotifyBackend() from providers.tsx.',
    );
  }

  const id = nextNotifId(input.pluginName);
  const createdAt = new Date().toISOString();
  const entry = { ...input, id, createdAt };

  _backend.write(entry);

  // Dispatch legacy mock-SSE event so existing subscribers keep working.
  publishMock('notifications:new', entry);
}
