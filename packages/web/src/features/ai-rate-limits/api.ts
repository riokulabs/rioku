/**
 * AI Semantic Rate Limits API — backed by the Zustand mock store.
 *
 * Uses Jaccard similarity as a cheap stand-in for the real cosine-embedding
 * match the daemon will perform. Deterministic metrics are derived from a
 * hash-seeded PRNG per-rule so repeated calls return stable series.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type {
  AiSemanticRateLimit,
  AuditEntry,
} from '@/api/resources/types';
import type {
  CreateRateLimitInput,
  MetricWindow,
  RateLimitFilter,
  RateLimitMetricsPoint,
  SimulateMatchResult,
  UpdateRateLimitInput,
} from './types';

const nextRuleId = makeIdFactory('airate-new');
const nextAuditId = makeIdFactory('audit-airate');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function getCurrentActorId(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function makeAuditEntry(
  actorId: string,
  tenantId: string | null,
  action: string,
  resourceId?: string,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  return {
    id: nextAuditId(),
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    resource_type: 'ai-rate-limit',
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier,
  };
}

/** Tokenise a string into lowercase word tokens. */
function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const tok of s.toLowerCase().split(/\s+/)) {
    if (tok.length > 0) out.add(tok);
  }
  return out;
}

/** Jaccard similarity of two token sets. */
function jaccard(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const tok of A) {
    if (B.has(tok)) inter += 1;
  }
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

/** djb2 string hash. */
function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — deterministic uniform float in [0, 1). */
function mulberry32(seed: number): () => number {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useRateLimitList(
  tenantId: string,
  filter: RateLimitFilter,
): AiSemanticRateLimit[] {
  const rules = useMockStore((s) => s.aiSemanticRateLimits);
  const search = filter.search.toLowerCase().trim();
  const results: AiSemanticRateLimit[] = [];
  for (const rule of Object.values(rules)) {
    if (rule.tenant_id !== tenantId) continue;
    if (filter.scopes.length > 0 && !filter.scopes.includes(rule.scope)) continue;
    if (filter.actions.length > 0 && !filter.actions.includes(rule.action))
      continue;
    if (filter.enabled !== undefined && rule.enabled !== filter.enabled)
      continue;
    if (search) {
      const nameMatch = rule.name.toLowerCase().includes(search);
      const descMatch = rule.description?.toLowerCase().includes(search) ?? false;
      if (!nameMatch && !descMatch) continue;
    }
    results.push(rule);
  }
  return results;
}

export function useRateLimitDetail(id: string): AiSemanticRateLimit | undefined {
  return useMockStore((s) => s.aiSemanticRateLimits[id]);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createRateLimit(
  tenantId: string,
  input: CreateRateLimitInput,
): Promise<AiSemanticRateLimit> {
  await simulateLatency('mutation');
  const id = nextRuleId();
  const rule: AiSemanticRateLimit = {
    id,
    tenant_id: tenantId,
    name: input.name,
    ...(input.description !== undefined ? { description: input.description } : {}),
    scope: input.scope,
    ...(input.agent_id !== undefined ? { agent_id: input.agent_id } : {}),
    ...(input.tool_id !== undefined ? { tool_id: input.tool_id } : {}),
    exemplars: [...input.exemplars],
    similarity_threshold: input.similarity_threshold,
    window_seconds: input.window_seconds,
    max_matches: input.max_matches,
    action: input.action,
    enabled: input.enabled ?? true,
    created_at: now(),
  };
  const state = useMockStore.getState();
  state.addEntity('aiSemanticRateLimits', rule);
  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      tenantId,
      'ai-rate-limit.create',
      id,
    ),
  );
  emitHostEvent('ai-rate-limit.created', {
    rule_id: id,
    tenant_id: tenantId,
    scope: input.scope,
    action: input.action,
  });
  return rule;
}

export async function updateRateLimit(
  id: string,
  input: UpdateRateLimitInput,
): Promise<AiSemanticRateLimit> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.aiSemanticRateLimits[id];
  if (!current) throw new Error(`Rate limit ${id} not found`);

  const patch: Partial<AiSemanticRateLimit> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.scope !== undefined) patch.scope = input.scope;
  if (input.agent_id !== undefined) patch.agent_id = input.agent_id;
  if (input.tool_id !== undefined) patch.tool_id = input.tool_id;
  if (input.exemplars !== undefined) patch.exemplars = [...input.exemplars];
  if (input.similarity_threshold !== undefined)
    patch.similarity_threshold = input.similarity_threshold;
  if (input.window_seconds !== undefined) patch.window_seconds = input.window_seconds;
  if (input.max_matches !== undefined) patch.max_matches = input.max_matches;
  if (input.action !== undefined) patch.action = input.action;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  const before = { ...current };
  state.updateEntity('aiSemanticRateLimits', id, patch);
  const updated = useMockStore.getState().aiSemanticRateLimits[id];
  if (!updated) throw new Error(`Rate limit ${id} vanished mid-update`);

  state.appendAudit({
    ...makeAuditEntry(
      getCurrentActorId(),
      current.tenant_id,
      'ai-rate-limit.update',
      id,
    ),
    diff: { before, after: updated },
  });
  emitHostEvent('ai-rate-limit.updated', {
    rule_id: id,
    tenant_id: current.tenant_id,
  });
  return updated;
}

export async function deleteRateLimit(id: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const rule = state.aiSemanticRateLimits[id];
  if (!rule) throw new Error(`Rate limit ${id} not found`);

  state.deleteEntity('aiSemanticRateLimits', id);
  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      rule.tenant_id,
      'ai-rate-limit.delete',
      id,
      'destructive',
    ),
  );
  emitHostEvent('ai-rate-limit.deleted', {
    rule_id: id,
    tenant_id: rule.tenant_id,
  });
}

// ─── Simulate ────────────────────────────────────────────────────────────────

/**
 * Cheap Jaccard-token-overlap match against the rule's exemplars. Returns
 * the highest-scoring exemplar and whether it clears the rule's threshold.
 */
export function simulateMatch(
  ruleId: string,
  candidateText: string,
): SimulateMatchResult {
  const rule = useMockStore.getState().aiSemanticRateLimits[ruleId];
  if (!rule) throw new Error(`Rate limit ${ruleId} not found`);

  let best = { score: 0, exemplar: '' };
  for (const ex of rule.exemplars) {
    const s = jaccard(ex, candidateText);
    if (s > best.score) best = { score: s, exemplar: ex };
  }
  const matched = best.score >= rule.similarity_threshold;
  return {
    matched,
    score: Number(best.score.toFixed(4)),
    ...(best.score > 0 ? { matched_exemplar: best.exemplar } : {}),
  };
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Deterministic metrics time-series for a rule. Bucket layouts:
 *   '1h'  → 60 × 1-minute buckets
 *   '24h' → 24 × 1-hour buckets
 *   '7d'  → 7  × 1-day buckets
 *
 * Values are derived from a rule-seeded PRNG, modulated by bucket-of-day so
 * "business hours" carry more traffic than the small hours. The last bucket
 * always ends at the call moment; bucket timestamps are ISO strings marking
 * the bucket's START.
 */
export function useRateLimitMetrics(
  ruleId: string,
  window: MetricWindow,
): RateLimitMetricsPoint[] {
  // Hook into the store so sparklines refresh when the rule itself changes.
  const rule = useMockStore((s) => s.aiSemanticRateLimits[ruleId]);
  if (!rule) return [];
  const seed = hashCode(ruleId);
  const rand = mulberry32(seed);
  const nowMs = Date.now();

  let bucketCount: number;
  let bucketMs: number;
  switch (window) {
    case '1h':
      bucketCount = 60;
      bucketMs = 60 * 1000;
      break;
    case '24h':
      bucketCount = 24;
      bucketMs = 60 * 60 * 1000;
      break;
    case '7d':
      bucketCount = 7;
      bucketMs = 24 * 60 * 60 * 1000;
      break;
  }

  const out: RateLimitMetricsPoint[] = [];
  for (let i = bucketCount - 1; i >= 0; i--) {
    const bucketStart = nowMs - i * bucketMs;
    const date = new Date(bucketStart);
    // Business-hours modulation — 09..17 local hours get boosted.
    const hour = date.getUTCHours();
    const boost = hour >= 9 && hour <= 17 ? 1.6 : 0.5;
    const raw = rand() * 20 * boost;
    out.push({
      timestamp: date.toISOString(),
      matches: Math.max(0, Math.round(raw)),
    });
  }
  return out;
}
