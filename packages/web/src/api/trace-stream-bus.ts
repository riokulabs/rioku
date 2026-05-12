/**
 * Trace-stream bus.
 *
 * Module-level EventTarget that carries newly-created AI traces. Used by:
 *   - `invokeAgentMock` (features/ai-agents/api.ts) to announce a new trace.
 *   - `subscribeTraceStream` (features/ai-traces/api.ts) to power the live-tail UI.
 *
 * The event is always `'trace'`; `event.detail` is the `AiTrace` instance.
 */
import type { AiTrace } from './resources';

/** Fixed topic string — only event name emitted on this bus. */
export const TRACE_STREAM_TOPIC = 'trace';

/** Singleton EventTarget acting as the trace-stream bus. */
export const traceStreamBus = new EventTarget();

/** Narrowed event type for listeners. */
export type TraceStreamEvent = CustomEvent<AiTrace>;

/**
 * Emit a trace to the bus. Called by the agent invoke-mock; consumers see it
 * as a `CustomEvent<AiTrace>` whose `detail` is the trace.
 */
export function publishTrace(trace: AiTrace): void {
  traceStreamBus.dispatchEvent(new CustomEvent(TRACE_STREAM_TOPIC, { detail: trace }));
}
