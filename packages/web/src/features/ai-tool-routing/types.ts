/**
 * Feature-local types for AI tool routing (bindings).
 */
export type { AiToolBinding, AiAgent, AiTool, ID } from '@/api/resources/types';

export interface BindingFilter {
  /** Restrict to these agents. Empty = no filter. */
  agent_ids: string[];
  /** Restrict to these tools. Empty = no filter. */
  tool_ids: string[];
  /** true = only enabled, false = only disabled, undefined = all. */
  enabled?: boolean;
  /** true = only bindings with a non-empty condition, false = only unconditional, undefined = all. */
  has_condition?: boolean;
}

export interface CreateBindingInput {
  agent_id: string;
  tool_id: string;
  /** CEL expression; empty string = always allow. */
  condition: string;
  enabled?: boolean;
}

export interface UpdateBindingInput {
  agent_id?: string;
  tool_id?: string;
  condition?: string;
  enabled?: boolean;
}

export interface PreviewConditionResult {
  parses: boolean;
  sample_result?: boolean;
  error?: string;
}
