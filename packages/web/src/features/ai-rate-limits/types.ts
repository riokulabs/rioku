/**
 * Feature-local types for AI semantic rate limits.
 */
export type { AiSemanticRateLimit, ID } from '@/api/resources';

import type { AiSemanticRateLimit } from '@/api/resources';

export interface RateLimitFilter {
  search: string;
  /** Restrict to these scopes. Empty = no filter. */
  scopes: AiSemanticRateLimit['scope'][];
  /** Restrict to these actions. Empty = no filter. */
  actions: AiSemanticRateLimit['action'][];
  /** true = only enabled, false = only disabled, undefined = all. */
  enabled?: boolean;
}

export interface CreateRateLimitInput {
  name: string;
  description?: string;
  scope: AiSemanticRateLimit['scope'];
  agent_id?: string;
  tool_id?: string;
  exemplars: string[];
  similarity_threshold: number;
  window_seconds: number;
  max_matches: number;
  action: AiSemanticRateLimit['action'];
  enabled?: boolean;
}

export interface UpdateRateLimitInput {
  name?: string;
  description?: string;
  scope?: AiSemanticRateLimit['scope'];
  agent_id?: string;
  tool_id?: string;
  exemplars?: string[];
  similarity_threshold?: number;
  window_seconds?: number;
  max_matches?: number;
  action?: AiSemanticRateLimit['action'];
  enabled?: boolean;
}

export interface SimulateMatchResult {
  matched: boolean;
  score: number;
  matched_exemplar?: string;
}

export type MetricWindow = '1h' | '24h' | '7d';

export interface RateLimitMetricsPoint {
  timestamp: string;
  matches: number;
}
