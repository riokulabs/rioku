// Owned by Plan 04 (ai) — types for the ai-rate-limits resource surface.

import type { ID } from './common';

/**
 * Semantic rate-limit rule. Applies across agents/tools by matching request shape
 * (scope) against a cosine-similarity threshold vs a provided exemplar corpus.
 */
export interface AiSemanticRateLimit {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  description?: string;
  scope: 'tenant' | 'agent' | 'tool';
  /** Populated when scope === 'agent'. */
  agent_id?: ID;
  /** Populated when scope === 'tool'. */
  tool_id?: ID;
  /** Exemplar corpus — mock: array of short strings. */
  exemplars: string[];
  /** Cosine similarity threshold (0.0–1.0). */
  similarity_threshold: number;
  /** Rolling window. */
  window_seconds: number;
  max_matches: number;
  /** Action on limit hit. */
  action: 'block' | 'degrade' | 'log';
  enabled: boolean;
  readonly created_at: string;
}
