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

/**
 * Input for the stage-2 probe-style simulator.
 * All fields optional — daemon applies sane defaults when omitted.
 */
export interface SimulateProbeInput {
  request_count?: number;
  time_window_seconds?: number;
  principal?: string;
}

/**
 * Daemon response shape for `/ai/rate-limits/{id}/simulate`.
 */
export interface SimulateProbeResult {
  rate_limit_id: string;
  principal?: string;
  would_throttle: boolean;
  retry_after_ms: number;
  current_consumption: number;
  limit: number;
}

export type MetricWindow = '1h' | '24h' | '7d';

export interface RateLimitMetricsPoint {
  timestamp: string;
  matches: number;
}
