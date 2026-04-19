/**
 * Plugin notification emitter — spec §9.5.7, §11
 *
 * Plugins call `emitPluginNotification(...)` to push notifications into the
 * notification inbox. The function validates the category naming convention
 * (must start with `plugin:<pluginName>:`) and delegates to an injected
 * backend (wired from main.tsx / providers.tsx via `setNotifyBackend`).
 *
 * BOUNDARY NOTE: `host/` cannot import `api/` directly (ESLint boundary rule).
 * Dependency injection is used: first-party boot code calls `setNotifyBackend`
 * once, supplying the write function from mock-store.
 */

import { publishMock } from '@/api/mock-sse';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationSeverity = 'info' | 'warn' | 'error' | 'success';

export interface PluginNotificationInput {
  pluginName: string;
  category: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  tenant?: string;
  user?: string;
}

export interface NotifyBackend {
  write(input: PluginNotificationInput & { id: string; createdAt: string }): void;
}

// ─── Injected backend ─────────────────────────────────────────────────────────

let _backend: NotifyBackend | null = null;

/**
 * Wire the notification backend. Called once from `main.tsx` or
 * `app/providers.tsx` after the mock-store is ready.
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
 *   - `category` must start with `plugin:<pluginName>:` (spec §11)
 *
 * Writes to the mock-store (via injected backend) and dispatches a mock-SSE
 * `notifications:new` event so the inbox bell reacts immediately.
 *
 * @throws if category does not follow the naming convention.
 * @throws if the notify backend has not been wired (call `setNotifyBackend`).
 */
export function emitPluginNotification(input: PluginNotificationInput): void {
  const expectedPrefix = `plugin:${input.pluginName}:`;
  if (!input.category.startsWith(expectedPrefix)) {
    throw new Error(
      `Plugin notification category must start with "${expectedPrefix}", got "${input.category}" (spec §11).`,
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

  // Dispatch mock-SSE event so the inbox bell updates without polling.
  publishMock('notifications:new', entry);
}
