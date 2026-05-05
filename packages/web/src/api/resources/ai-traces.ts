// Owned by Plan 04 (ai) — types for the ai-traces resource surface.

import type { ID } from './common';

export interface AiTraceToolCall {
  readonly tool_id: ID;
  readonly tool_name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  latency_ms: number;
  status: 'success' | 'error' | 'timeout';
  error_message?: string;
}

export interface AiTrace {
  readonly id: ID;
  readonly tenant_id: ID;
  readonly agent_id: ID;
  readonly session_id?: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  status: 'success' | 'error' | 'timeout';
  readonly at: string;
  // New in Plan 3:
  /** Provider + model used — redundant with agent but captured at trace time for historical fidelity. */
  provider_id: ID;
  model: string;
  prompt_text: string;
  completion_text: string;
  tool_calls: AiTraceToolCall[];
  cost_usd: number;
  error_message?: string;
  /** User-facing request id (from gateway). */
  request_id: string;
}
