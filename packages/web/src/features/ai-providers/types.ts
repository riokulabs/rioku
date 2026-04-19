/**
 * Feature-local types for AI providers.
 */
export type {
  AiProvider,
  AiAgent,
  AiProviderModel,
  ID,
} from '@/api/resources/types';

import type { AiProvider } from '@/api/resources/types';

export interface ProviderFilter {
  search: string;
  /** Selected kinds. Empty array = no filter. */
  kinds: AiProvider['kind'][];
  /** true = only enabled, false = only disabled, undefined = all. */
  enabled?: boolean;
}

export interface CreateProviderInput {
  name: string;
  kind: AiProvider['kind'];
  base_url: string;
  description?: string;
  /** Raw credential — mock stores prefix-only. */
  credential: string;
  enabled?: boolean;
}

export interface UpdateProviderInput {
  name?: string;
  kind?: AiProvider['kind'];
  base_url?: string;
  description?: string;
  /** If present, credential_ref.prefix is rotated using this raw value. */
  credential?: string;
  enabled?: boolean;
}

export interface AddModelInput {
  upstream_id: string;
  alias: string;
  rate_limit_rpm: number | null;
  daily_quota_tokens: number | null;
  enabled?: boolean;
}

export interface UpdateModelInput {
  alias?: string;
  rate_limit_rpm?: number | null;
  daily_quota_tokens?: number | null;
  enabled?: boolean;
}

export interface TestProviderResult {
  ok: boolean;
  latency_ms: number;
  tested_at: string;
  error_message?: string;
}

export class ProviderInUseError extends Error {
  readonly code = 'PROVIDER_IN_USE';
  readonly agentIds: string[];
  constructor(agentIds: string[]) {
    super(
      `Provider cannot be deleted — ${String(agentIds.length)} agent(s) reference it.`,
    );
    this.name = 'ProviderInUseError';
    this.agentIds = agentIds;
  }
}

export class ProviderModelInUseError extends Error {
  readonly code = 'PROVIDER_MODEL_IN_USE';
  readonly agentIds: string[];
  constructor(agentIds: string[]) {
    super(
      `Model cannot be removed — ${String(agentIds.length)} agent(s) use this alias.`,
    );
    this.name = 'ProviderModelInUseError';
    this.agentIds = agentIds;
  }
}
