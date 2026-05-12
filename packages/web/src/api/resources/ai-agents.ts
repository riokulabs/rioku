// Types for the ai-agents resource surface.

import type { ID } from './common';

export interface AiAgent {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  provider_id: ID;
  /** Model alias from the provider's `models[].alias`. */
  model: string;
  system_prompt: string;
  tool_ids: ID[];
  enabled: boolean;
  description?: string;
  /** Scoped credential reference; agent can hold its own API key distinct from provider. */
  scoped_credential_ref?: { prefix: string; created_at: string };
  /** RBAC role bindings — which roles are allowed to invoke this agent. */
  role_ids: ID[];
  /** Guardrails. */
  max_tokens_per_request: number;
  temperature: number;
  stop_sequences: string[];
  readonly created_at: string;
  readonly updated_at: string;
}
