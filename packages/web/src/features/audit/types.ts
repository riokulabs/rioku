/**
 * Feature-local types for the Audit feature.
 *
 * Mirrors the Plan 5 shape: bounded + unbounded filter criteria, opaque
 * handles for PII-sensitive values (actor + resource-id), and listener
 * callback signatures for the mock streaming bus.
 */
import type { AuditEntry, AuditRetentionConfig, ID } from '@/api/resources';

export type { AuditEntry, AuditRetentionConfig, ID };

/**
 * Combined bounded + unbounded audit filter. All array fields are treated
 * as inclusive OR — an empty array means "no filter on this axis". Date
 * bounds are ISO strings; `date_from` is inclusive, `date_to` is exclusive
 * (the filter-bar pushes it to end-of-day for a calendar-day feel).
 */
export interface AuditFilter {
  /** Bounded enum — audit action strings. */
  actions: string[];
  /** Bounded enum — outcome buckets. */
  outcomes: ('success' | 'denied' | 'error')[];
  /** Bounded enum — resource types. */
  resource_types: string[];
  /** Bounded enum — audit tiers. */
  tiers: ('read' | 'read-sensitive' | 'write' | 'destructive')[];
  /** Inclusive ISO lower bound on `at`. `null` = no lower bound. */
  date_from: string | null;
  /** Exclusive ISO upper bound on `at`. `null` = no upper bound. */
  date_to: string | null;
  /** Opaque actor handles — see §13.2a. Format: `user_<id>`. */
  actor_handles: string[];
  /** Opaque resource-id handles. Format: `res_<type>_<id>`. */
  resource_id_handles: string[];
  /** Free-text search. Requires `audit:read-sensitive` to include payload bodies. */
  search: string;
}

/** Callback fired when a new audit entry lands on the bus. */
export type AuditStreamListener = (entry: AuditEntry) => void;

/**
 * Async-search result page — used by `searchActors` /
 * `searchResourceIds` to back the unbounded MultiSelect widgets.
 */
export interface AsyncSearchPage<T> {
  items: T[];
  nextCursor?: string;
}

/** A single actor candidate surfaced by `searchActors`. */
export interface ActorCandidate {
  /** Opaque handle the URL + filter carry. */
  handle: string;
  /** Human label for rendering in the MultiSelect options. */
  label: string;
}

/** A single resource-id candidate surfaced by `searchResourceIds`. */
export interface ResourceIdCandidate {
  handle: string;
  label: string;
  resource_type: string;
}

/** Input to `updateRetentionConfig`. */
export interface UpdateRetentionConfigInput {
  retention_days: AuditRetentionConfig['retention_days'];
  auto_export: AuditRetentionConfig['auto_export'];
  auto_export_format: AuditRetentionConfig['auto_export_format'];
}

/**
 * Return shape of {@link useAuditListInfinite} — mirrors the surface
 * TanStack Query's `useInfiniteQuery` exposes so call sites can swap in
 * the real network-backed version in Stage 2 with no changes.
 */
export interface AuditListInfiniteResult {
  data: AuditEntry[];
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetching: boolean;
}
