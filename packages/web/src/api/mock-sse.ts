/**
 * Mock SSE bus via EventTarget — Stage 1 host event bus.
 *
 * TODO(plan-0a): This module was scheduled for deletion in Task 15 but retained
 * because 16 consumers (host/events.ts, host/notify.ts, hooks/use-subscription.ts,
 * and 13 test files) rely on mockBus/publishMock as the host event bus. Migration
 * to sse-client + MSW is deferred to Plan 13 close-out, which asserts zero importers
 * before deleting this file.
 *
 * In Stage 2+, this module is replaced by a real EventSource wrapper
 * that connects to /api/v1/events?topic=<topic>. The `useSubscription`
 * hook (src/hooks/use-subscription.ts) swaps transparently.
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
