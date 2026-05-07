/**
 * AI Semantic Rate Limits API — stage 2 wiring.
 *
 * This module is the public ai-rate-limits API surface. It is backed by
 * the Orval-generated TanStack Query hooks under
 * `@/api/generated/ai-rate-limits/ai-rate-limits` so every consumer that
 * imports from `features/ai-rate-limits` ends up calling the live daemon
 * REST endpoints under `/api/v1/t/{tenant}/ai/rate-limits/...`.
 *
 * Public names (`useRateLimitList`, `useRateLimitDetail`,
 * `createRateLimit`, `updateRateLimit`, `deleteRateLimit`,
 * `useRateLimitMetrics`, `simulateMatch`) are preserved. Mutators take
 * an explicit tenant id since the REST surface is tenant-scoped.
 *
 * Adapter:
 *   The daemon proto shape (`AIRateLimit`, camelCase) is translated to
 *   the admin `AiSemanticRateLimit` shape (snake_case, includes derived
 *   fields). `threshold` ↔ `max_matches`. `description` is not in the
 *   daemon model yet — adapter returns `undefined`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAIRateLimits,
  getAIRateLimit,
  createAIRateLimit as orvalCreateAIRateLimit,
  updateAIRateLimit as orvalUpdateAIRateLimit,
  deleteAIRateLimit as orvalDeleteAIRateLimit,
  simulateAIRateLimit as orvalSimulateAIRateLimit,
  getAIRateLimitMetrics as orvalGetAIRateLimitMetrics,
  getListAIRateLimitsQueryKey,
  getGetAIRateLimitQueryKey,
  getGetAIRateLimitMetricsQueryKey,
} from '@/api/generated/ai-rate-limits/ai-rate-limits';
import type {
  AIRateLimit,
  AIRateLimitCreateRequest,
  AIRateLimitSimulateRequest,
  AIRateLimitUpdateRequest,
  AIRateLimitMetricsPoint,
} from '@/api/generated/schemas';
import type { AiSemanticRateLimit } from '@/api/resources';
import type {
  CreateRateLimitInput,
  MetricWindow,
  RateLimitFilter,
  RateLimitMetricsPoint,
  SimulateMatchResult,
  UpdateRateLimitInput,
  SimulateProbeInput,
  SimulateProbeResult,
} from './types';

// ─── Adapter ──────────────────────────────────────────────────────────────────

/** Translate a daemon `AIRateLimit` to the admin `AiSemanticRateLimit`. */
function fromProto(p: AIRateLimit): AiSemanticRateLimit {
  const scope: AiSemanticRateLimit['scope'] =
    p.scope === 'agent' || p.scope === 'tool' ? p.scope : 'tenant';
  const action: AiSemanticRateLimit['action'] =
    p.action === 'block' || p.action === 'degrade' || p.action === 'log' ? p.action : 'log';
  return {
    id: p.id,
    tenant_id: p.tenantId,
    name: p.name,
    scope,
    ...(p.agentId ? { agent_id: p.agentId } : {}),
    ...(p.toolId ? { tool_id: p.toolId } : {}),
    exemplars: p.exemplars ?? [],
    similarity_threshold: p.similarityThreshold ?? 0,
    window_seconds: p.windowSeconds ?? 60,
    max_matches: p.threshold ?? 0,
    action,
    enabled: p.enabled,
    created_at: p.createdAt,
  };
}

function toCreateBody(input: CreateRateLimitInput): AIRateLimitCreateRequest {
  return {
    name: input.name,
    scope: input.scope,
    ...(input.agent_id !== undefined ? { agentId: input.agent_id } : {}),
    ...(input.tool_id !== undefined ? { toolId: input.tool_id } : {}),
    exemplars: [...input.exemplars],
    similarityThreshold: input.similarity_threshold,
    windowSeconds: input.window_seconds,
    threshold: input.max_matches,
    action: input.action,
  };
}

function toUpdateBody(input: UpdateRateLimitInput): AIRateLimitUpdateRequest {
  const out: AIRateLimitUpdateRequest = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.scope !== undefined) out.scope = input.scope;
  if (input.agent_id !== undefined) out.agentId = input.agent_id;
  if (input.tool_id !== undefined) out.toolId = input.tool_id;
  if (input.exemplars !== undefined) out.exemplars = [...input.exemplars];
  if (input.similarity_threshold !== undefined) out.similarityThreshold = input.similarity_threshold;
  if (input.window_seconds !== undefined) out.windowSeconds = input.window_seconds;
  if (input.max_matches !== undefined) out.threshold = input.max_matches;
  if (input.action !== undefined) out.action = input.action;
  if (input.enabled !== undefined) out.enabled = input.enabled;
  return out;
}

// ─── Selectors (query hooks) ──────────────────────────────────────────────────

/**
 * Returns rate-limit rules for a tenant after applying client-side filters.
 * Wraps `listAIRateLimits` and projects only the array so legacy call sites
 * (`useRateLimitList(...)` returning `AiSemanticRateLimit[]`) keep working.
 */
export function useRateLimitList(
  tenantId: string,
  filter: RateLimitFilter,
): AiSemanticRateLimit[] {
  const { data } = useQuery({
    queryKey: getListAIRateLimitsQueryKey(tenantId),
    queryFn: ({ signal }) => listAIRateLimits(tenantId, { signal }),
    enabled: Boolean(tenantId),
  });
  const items = data?.data.items ?? [];

  const search = filter.search.toLowerCase().trim();
  const out: AiSemanticRateLimit[] = [];
  for (const proto of items) {
    if (proto.tenantId !== tenantId) continue;
    const rule = fromProto(proto);
    if (filter.scopes.length > 0 && !filter.scopes.includes(rule.scope)) continue;
    if (filter.actions.length > 0 && !filter.actions.includes(rule.action)) continue;
    if (filter.enabled !== undefined && rule.enabled !== filter.enabled) continue;
    if (search && !rule.name.toLowerCase().includes(search)) continue;
    out.push(rule);
  }
  return out;
}

/**
 * Returns a single rate-limit rule for a tenant. Stage-2 signature requires
 * an explicit tenantId because the REST surface is tenant-scoped; legacy
 * stage-1 callers that passed only `id` are migrated alongside this rewrite.
 */
export function useRateLimitDetail(
  tenantId: string,
  id: string,
): AiSemanticRateLimit | undefined {
  const { data } = useQuery({
    queryKey: getGetAIRateLimitQueryKey(tenantId, id),
    queryFn: ({ signal }) => getAIRateLimit(tenantId, id, { signal }),
    enabled: Boolean(tenantId) && Boolean(id),
  });
  if (!data) return undefined;
  return fromProto(data.data);
}

// ─── Mutations (imperative) ───────────────────────────────────────────────────

/**
 * Create a rate-limit rule. Real endpoint: POST
 * `/api/v1/t/{tenantId}/ai/rate-limits`.
 */
export async function createRateLimit(
  tenantId: string,
  input: CreateRateLimitInput,
): Promise<AiSemanticRateLimit> {
  const res = await orvalCreateAIRateLimit(tenantId, toCreateBody(input));
  return fromProto(res.data);
}

/**
 * Update a rate-limit rule. Stage-2 signature requires an explicit
 * tenantId. Real endpoint: PUT `/api/v1/t/{tenantId}/ai/rate-limits/{id}`.
 */
export async function updateRateLimit(
  tenantId: string,
  id: string,
  input: UpdateRateLimitInput,
): Promise<AiSemanticRateLimit> {
  const res = await orvalUpdateAIRateLimit(tenantId, id, toUpdateBody(input));
  return fromProto(res.data);
}

/**
 * Delete a rate-limit rule. Real endpoint: DELETE
 * `/api/v1/t/{tenantId}/ai/rate-limits/{id}`.
 */
export async function deleteRateLimit(tenantId: string, id: string): Promise<void> {
  await orvalDeleteAIRateLimit(tenantId, id);
}

// ─── Mutation hooks (with cache invalidation) ─────────────────────────────────

export function useCreateRateLimitMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRateLimitInput) => createRateLimit(tenantId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getListAIRateLimitsQueryKey(tenantId) });
    },
  });
}

export function useUpdateRateLimitMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRateLimitInput }) =>
      updateRateLimit(tenantId, id, input),
    onSuccess: (_d, { id }) => {
      void qc.invalidateQueries({ queryKey: getListAIRateLimitsQueryKey(tenantId) });
      void qc.invalidateQueries({ queryKey: getGetAIRateLimitQueryKey(tenantId, id) });
    },
  });
}

export function useDeleteRateLimitMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRateLimit(tenantId, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getListAIRateLimitsQueryKey(tenantId) });
    },
  });
}

// ─── Simulate ─────────────────────────────────────────────────────────────────

/**
 * Run the daemon's deterministic simulator against a configured rule.
 * Real endpoint: POST `/api/v1/t/{tenantId}/ai/rate-limits/{id}/simulate`.
 * Body: `{ request_count, time_window_seconds, principal }` (all optional).
 */
export async function simulateRateLimitProbe(
  tenantId: string,
  id: string,
  input: SimulateProbeInput,
): Promise<SimulateProbeResult> {
  const body: AIRateLimitSimulateRequest = {
    ...(input.request_count !== undefined ? { request_count: input.request_count } : {}),
    ...(input.time_window_seconds !== undefined
      ? { time_window_seconds: input.time_window_seconds }
      : {}),
    ...(input.principal !== undefined ? { principal: input.principal } : {}),
  };
  const res = await orvalSimulateAIRateLimit(tenantId, id, body);
  const data = res.data;
  return {
    rate_limit_id: data.rate_limit_id,
    ...(data.principal !== undefined ? { principal: data.principal } : {}),
    would_throttle: data.would_throttle,
    retry_after_ms: data.retry_after_ms,
    current_consumption: data.current_consumption,
    limit: data.limit,
  };
}

/**
 * TanStack mutation hook around `simulateRateLimitProbe`. Components in the
 * Simulate tab use this so they get loading + error state for free.
 */
export function useSimulateRateLimitProbeMutation(tenantId: string, id: string) {
  return useMutation({
    mutationFn: (input: SimulateProbeInput) => simulateRateLimitProbe(tenantId, id, input),
  });
}

/**
 * Compatibility shim. `simulateMatch(ruleId, candidateText)` returned a
 * Jaccard-like score in stage-1; the daemon doesn't ship that primitive
 * yet, and the UI consumer has migrated to the probe-style simulator.
 * This wrapper exists so the public name from the barrel keeps resolving
 * and any third-party caller gets a `matched: false` result with a
 * deterministic 0 score instead of a runtime crash. Prefer
 * `simulateRateLimitProbe`.
 *
 * @deprecated Use `simulateRateLimitProbe` against the real daemon instead.
 */
export function simulateMatch(_ruleId: string, _candidateText: string): SimulateMatchResult {
  return { matched: false, score: 0 };
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Pull the throttle-event time-series for a rate-limit. Real endpoint:
 * GET `/api/v1/t/{tenantId}/ai/rate-limits/{id}/metrics?since={window}`.
 *
 * The legacy stage-1 hook returned `{timestamp, matches}`; we keep that
 * shape so the existing sparkline keeps working unchanged. New code should
 * read `throttle_events` directly via `useRateLimitMetricsRaw`.
 */
export function useRateLimitMetrics(
  tenantId: string,
  ruleId: string,
  window: MetricWindow,
): RateLimitMetricsPoint[] {
  const points = useRateLimitMetricsRaw(tenantId, ruleId, window);
  return points.map((p) => ({ timestamp: p.timestamp, matches: p.throttle_events }));
}

/**
 * Stage-2 native metrics hook — returns the daemon shape directly.
 */
export function useRateLimitMetricsRaw(
  tenantId: string,
  ruleId: string,
  window: MetricWindow,
): AIRateLimitMetricsPoint[] {
  const { data } = useQuery({
    queryKey: getGetAIRateLimitMetricsQueryKey(tenantId, ruleId, { since: window }),
    queryFn: ({ signal }) =>
      orvalGetAIRateLimitMetrics(tenantId, ruleId, { since: window }, { signal }),
    enabled: Boolean(tenantId) && Boolean(ruleId),
  });
  if (!data) return [];
  return data.data.points;
}
