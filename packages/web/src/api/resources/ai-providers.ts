// Types for the ai-providers resource surface.

import type { ID } from './common';

export interface AiProviderModel {
  /** Canonical upstream model id, e.g. "gpt-4o" or "claude-3-7-sonnet". */
  upstream_id: string;
  /** User-friendly alias surfaced in agent config. */
  alias: string;
  /** Per-model rate/quota. Null = inherit provider default. */
  rate_limit_rpm: number | null;
  daily_quota_tokens: number | null;
  enabled: boolean;
}

export interface AiProvider {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  kind: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'custom';
  base_url: string;
  enabled: boolean;
  description?: string;
  /** Credential reference — stores prefix-only; real value never persisted after create. */
  credential_ref: { prefix: string; created_at: string };
  /** Published model aliases backed by this provider. */
  models: AiProviderModel[];
  readonly created_at: string;
  readonly updated_at: string;
}
