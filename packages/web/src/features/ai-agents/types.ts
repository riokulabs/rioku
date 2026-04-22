/**
 * Feature-local types for AI agents.
 */
export type { AiAgent, AiProvider, AiTool, AiTrace, ID } from '@/api/resources/types';

export interface AgentFilter {
  search: string;
  /** Restrict to agents bound to these providers. Empty = no filter. */
  provider_ids: string[];
  /** true = only enabled, false = only disabled, undefined = all. */
  enabled?: boolean;
  /** Restrict to agents whose role_ids intersect this list. */
  role_ids: string[];
}

export interface CreateAgentInput {
  name: string;
  provider_id: string;
  model: string;
  system_prompt: string;
  tool_ids: string[];
  enabled?: boolean;
  description?: string;
  /** Raw credential; prefix-only persisted. */
  scoped_credential?: string;
  role_ids: string[];
  max_tokens_per_request: number;
  temperature: number;
  stop_sequences: string[];
}

export interface UpdateAgentInput {
  name?: string;
  provider_id?: string;
  model?: string;
  system_prompt?: string;
  tool_ids?: string[];
  enabled?: boolean;
  description?: string;
  role_ids?: string[];
  max_tokens_per_request?: number;
  temperature?: number;
  stop_sequences?: string[];
}

export interface InvokeAgentInput {
  prompt: string;
  /** Optional session id carried onto the trace (kept stable across re-invokes). */
  session_id?: string;
}
