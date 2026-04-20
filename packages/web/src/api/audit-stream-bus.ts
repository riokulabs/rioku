/**
 * Audit-stream bus — Stage 1 only.
 *
 * Module-level EventTarget that carries newly-appended audit entries to
 * interested UI subscribers (e.g. the audit live-tail). Any write that
 * calls `appendAudit` is expected to also publish on this bus via
 * {@link publishAudit}. In Stage 2+, this module is replaced by a real
 * SSE/WebSocket stream backed by the daemon.
 *
 * The emitted event is always `'audit'`; `event.detail` is the `AuditEntry`.
 */
import type { AuditEntry } from './resources/types';

/** Fixed topic string — only event name emitted on this bus. */
export const AUDIT_STREAM_TOPIC = 'audit';

/** Singleton EventTarget acting as the audit-stream bus. */
export const auditStreamBus = new EventTarget();

/** Narrowed event type for listeners. */
export type AuditStreamEvent = CustomEvent<AuditEntry>;

/**
 * Emit an audit entry to the bus. Consumers see it as a `CustomEvent<AuditEntry>`
 * whose `detail` is the entry.
 */
export function publishAudit(entry: AuditEntry): void {
  auditStreamBus.dispatchEvent(
    new CustomEvent(AUDIT_STREAM_TOPIC, { detail: entry }),
  );
}
