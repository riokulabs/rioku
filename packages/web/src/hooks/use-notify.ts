/**
 * notify — centralised toast helpers wrapping @mantine/notifications.
 *
 * All toast calls in the app should route through here so colour, timing, and
 * correlation-ID rendering are consistent and easy to update in one place
 * (e.g., for a future i18n pass).
 *
 * The imperative `notify` object can be called from anywhere (event handlers,
 * plain TS modules). `useNotify()` is a hook-convention alias for React
 * components that prefer the hooks-first style — it returns the same object.
 */

import { notifications } from '@mantine/notifications';

export interface NotifyErrorOptions {
  /** Optional correlation ID to append to the toast body. */
  correlationId?: string | undefined;
}

function success(title: string, message?: string): void {
  notifications.show({
    color: 'green',
    title,
    message,
    autoClose: 4000,
  });
}

function info(title: string, message?: string): void {
  notifications.show({
    color: 'blue',
    title,
    message,
    autoClose: 4000,
  });
}

function warn(title: string, message?: string): void {
  notifications.show({
    color: 'yellow',
    title,
    message,
    autoClose: 6000,
  });
}

function error(title: string, message?: string, options?: NotifyErrorOptions): void {
  const body = options?.correlationId
    ? `${message ?? ''}${message ? ' ' : ''}(ref: ${options.correlationId})`
    : message;

  notifications.show({
    color: 'red',
    title,
    message: body,
    autoClose: 8000,
  });
}

/** Imperative singleton — safe to call outside React render. */
export const notify = { success, info, warn, error } as const;

/** Hook-convention alias for components that prefer `const notify = useNotify()`. */
export function useNotify() {
  return notify;
}
