/**
 * Feature-local types for AI traces.
 *
 * Traces are system-written (the invoke-mock path on agents emits them). This
 * surface is read-only + subscribe + CSV export; no create/update/delete.
 */
export type {
  AiTrace,
  AiTraceToolCall,
  ID,
} from '@/api/resources/types';

import type { AiTrace } from '@/api/resources/types';

export interface TraceFilter {
  /** Free-text search across prompt + completion. */
  search: string;
  /** Restrict to these agents. Empty = no filter. */
  agent_ids: string[];
  /** Restrict to these statuses. Empty = no filter. */
  statuses: AiTrace['status'][];
  /** Inclusive lower bound on `at` (ISO string). */
  since?: string;
  /** Exclusive upper bound on `at` (ISO string). */
  until?: string;
}

/** Callback fired when a new trace lands on the bus. */
export type TraceStreamListener = (trace: AiTrace) => void;
