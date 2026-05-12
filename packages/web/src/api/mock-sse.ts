/**
 * Mock SSE bus via EventTarget — in-memory host event bus.
 *
 * TODO: Migrate consumers (host/events.ts, host/notify.ts,
 * hooks/use-subscription.ts, and test files) to sse-client + MSW and delete
 * this module.
 *
 * The `useSubscription` hook (src/hooks/use-subscription.ts) can be swapped
 * transparently to a real EventSource wrapper against
 * /api/v1/events?topic=<topic>.
 *
 * Usage:
 *   import { mockBus, publishMock } from '@/api/mock-sse';
 *   publishMock('users.updated', { id: 'user_1', ...delta });
 *
 * Consumers subscribe via the `useSubscription` hook or directly:
 *   mockBus.addEventListener('users.updated', (e) => { ... });
 */

/** Singleton EventTarget acting as the in-memory SSE bus. */
export const mockBus = new EventTarget();

/**
 * Dispatch a typed event on the mock bus.
 *
 * @param topic  - Dot-separated topic string (e.g. "users.updated").
 * @param detail - Arbitrary payload; consumers receive it as `event.detail`.
 */
export function publishMock(topic: string, detail: unknown): void {
  mockBus.dispatchEvent(new CustomEvent(topic, { detail }));
}
