/**
 * Notification routing rules API — CRUD + atomic reorder (stage-2, daemon-backed).
 *
 * Routes:
 *   GET    /api/v1/t/{tenant}/notification-routing               list
 *   POST   /api/v1/t/{tenant}/notification-routing               create
 *   GET    /api/v1/t/{tenant}/notification-routing/{id}          detail
 *   PUT    /api/v1/t/{tenant}/notification-routing/{id}          update
 *   DELETE /api/v1/t/{tenant}/notification-routing/{id}          delete
 *   PUT    /api/v1/t/{tenant}/notification-routing/order         reorder
 *
 * The daemon stores `eventFilter` as raw JSON, but the legacy client model
 * expects a string (CEL/glob expression). We normalise both directions so
 * callers see/work with the legacy string representation.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveTenant } from '@/features/notifications/api';
import { customFetch } from '@/api/mutator';
import { emitHostEvent } from '@/host/events';
import type { ID, NotificationRoutingRule } from '@/api/resources';

import type { CreateRoutingRuleInput, RoutingRuleFilter, UpdateRoutingRuleInput } from './types';
import { createRoutingRuleSchema, updateRoutingRuleSchema } from './schemas';

// ─── Daemon DTO + mapper ──────────────────────────────────────────────────────

interface DaemonRoutingRule {
  id: string;
  tenantId: string;
  name: string;
  /** Daemon stores raw JSON; we serialise CEL/glob expressions as `{"expr": "<expr>"}`. */
  eventFilter: { expr?: string } | Record<string, unknown> | null;
  channelIds: string[] | null;
  enabled: boolean;
  orderHint: number;
  createdAt: string;
  updatedAt: string;
}

interface ListRulesResponse {
  items: DaemonRoutingRule[];
  total: number;
}

function decodeFilter(d: DaemonRoutingRule['eventFilter']): string {
  if (!d) return '';
  if (typeof d === 'object' && 'expr' in d && typeof d.expr === 'string') return d.expr;
  try {
    return JSON.stringify(d);
  } catch {
    return '';
  }
}

function encodeFilter(expr: string): { expr: string } {
  return { expr };
}

function mapRule(d: DaemonRoutingRule): NotificationRoutingRule {
  return {
    id: d.id,
    tenant_id: d.tenantId,
    name: d.name,
    event_filter: decodeFilter(d.eventFilter),
    channel_ids: d.channelIds ?? [],
    enabled: d.enabled,
    order_hint: d.orderHint,
    created_at: d.createdAt,
  };
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const routingKeys = {
  all: (tenant: string) => ['notification-routing', tenant] as const,
  list: (tenant: string) => ['notification-routing', tenant, 'list'] as const,
  detail: (tenant: string, id: string) => ['notification-routing', tenant, id] as const,
};

// ─── Filter ───────────────────────────────────────────────────────────────────

function matchesFilter(rule: NotificationRoutingRule, filter: RoutingRuleFilter): boolean {
  if (filter.enabled !== undefined && rule.enabled !== filter.enabled) return false;
  const search = filter.search.trim().toLowerCase();
  if (search) {
    const hay = `${rule.name} ${rule.event_filter}`.toLowerCase();
    if (!hay.includes(search)) return false;
  }
  return true;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

async function fetchRules(tenant: string): Promise<NotificationRoutingRule[]> {
  const data = await customFetch<ListRulesResponse>({
    url: `/t/${tenant}/notification-routing`,
    method: 'GET',
  });
  const items = data.items.map(mapRule);
  items.sort((a, b) => a.order_hint - b.order_hint);
  return items;
}

export function useRoutingRuleList(
  tenantId: ID,
  filter: RoutingRuleFilter,
): NotificationRoutingRule[] {
  const tenant = resolveTenant();
  const { data } = useQuery({
    queryKey: routingKeys.list(tenant),
    queryFn: () => fetchRules(tenant),
    staleTime: 30_000,
    enabled: !!tenant,
  });
  const items = data ?? [];
  // `r.tenant_id` is the daemon's internal id (`tenant_…`) while
  // `tenantId` is the URL slug (`acme`); the previous strict-equals
  // dropped every row on non-default tenants. The daemon already scopes
  // the fetch via the URL — keep only the user-facing filter predicate.
  void tenantId;
  return items.filter((r) => matchesFilter(r, filter));
}

export function useRoutingRuleDetail(id: ID): NotificationRoutingRule | undefined {
  const tenant = resolveTenant();
  const { data } = useQuery({
    queryKey: routingKeys.detail(tenant, id),
    queryFn: () =>
      customFetch<DaemonRoutingRule>({
        url: `/t/${tenant}/notification-routing/${id}`,
        method: 'GET',
      }).then(mapRule),
    staleTime: 30_000,
    enabled: !!tenant && !!id,
  });
  return data;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createRoutingRule(
  input: CreateRoutingRuleInput,
): Promise<NotificationRoutingRule> {
  const tenant = resolveTenant();
  const parsed = createRoutingRuleSchema.parse(input);
  const data = await customFetch<DaemonRoutingRule>({
    url: `/t/${tenant}/notification-routing`,
    method: 'POST',
    data: {
      name: parsed.name,
      eventFilter: encodeFilter(parsed.event_filter),
      channelIds: parsed.channel_ids,
      orderHint: parsed.order_hint ?? 0,
    },
  });
  emitHostEvent('notification-routing:created', {
    rule_id: data.id,
    tenant_id: data.tenantId,
  });
  return mapRule(data);
}

export async function updateRoutingRule(
  id: ID,
  input: UpdateRoutingRuleInput,
): Promise<NotificationRoutingRule | undefined> {
  const tenant = resolveTenant();
  const parsed = updateRoutingRuleSchema.parse(input);
  try {
    const data = await customFetch<DaemonRoutingRule>({
      url: `/t/${tenant}/notification-routing/${id}`,
      method: 'PUT',
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.event_filter !== undefined
          ? { eventFilter: encodeFilter(parsed.event_filter) }
          : {}),
        ...(parsed.channel_ids !== undefined ? { channelIds: parsed.channel_ids } : {}),
        ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
        ...(parsed.order_hint !== undefined ? { orderHint: parsed.order_hint } : {}),
      },
    });
    emitHostEvent('notification-routing:updated', {
      rule_id: data.id,
      tenant_id: data.tenantId,
    });
    return mapRule(data);
  } catch {
    return undefined;
  }
}

export async function deleteRoutingRule(id: ID): Promise<boolean> {
  const tenant = resolveTenant();
  try {
    await customFetch<unknown>({
      url: `/t/${tenant}/notification-routing/${id}`,
      method: 'DELETE',
    });
    emitHostEvent('notification-routing:deleted', { rule_id: id });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reorder rules within a tenant — full-replace of evaluation order based on
 * the supplied rule-id array (earlier ids run first).
 */
export async function reorderRoutingRules(
  tenantId: ID,
  ruleIds: ID[],
): Promise<NotificationRoutingRule[]> {
  const tenant = resolveTenant();
  if (ruleIds.length === 0) return [];
  await customFetch<unknown>({
    url: `/t/${tenant}/notification-routing/order`,
    method: 'PUT',
    data: { orderedIds: ruleIds },
  });
  emitHostEvent('notification-routing:reordered', {
    tenant_id: tenantId,
    rule_ids: ruleIds,
  });
  return fetchRules(tenant);
}

// ─── Hook helpers ─────────────────────────────────────────────────────────────

export function useInvalidateRoutingRules(): () => void {
  const qc = useQueryClient();
  const tenant = resolveTenant();
  return () => {
    void qc.invalidateQueries({ queryKey: routingKeys.all(tenant) });
  };
}

// ─── Sample-event CEL preview helper ──────────────────────────────────────────

/**
 * Evaluate a glob/key=value filter expression against a sample event
 * client-side — used by the routing-rule form's "Test against sample event"
 * preview button. The real evaluation runs server-side at dispatch time.
 *
 * Supported expression syntax:
 *   - "*"                   → match any event
 *   - "<prefix>.*"          → prefix match on `category`
 *   - "<exact-category>"    → exact category match
 *   - "category=<v>"        → exact category match (key=value)
 *   - "severity=<v>"        → exact severity match
 *   - whitespace-separated combinations are AND'd
 */
export function previewMatch(
  expression: string,
  sample: { category: string; severity: string },
): { match: boolean; reason: string } {
  const expr = expression.trim();
  if (!expr) return { match: false, reason: 'Empty expression — no events would match.' };
  const tokens = expr.split(/\s+/);
  for (const token of tokens) {
    if (token === '*') continue;
    if (token.includes('=')) {
      const [k, v] = token.split('=', 2);
      if (k === 'category' && v !== sample.category) {
        return { match: false, reason: `category mismatch: ${sample.category} ≠ ${v ?? ''}` };
      }
      if (k === 'severity' && v !== sample.severity) {
        return { match: false, reason: `severity mismatch: ${sample.severity} ≠ ${v ?? ''}` };
      }
      continue;
    }
    if (token.endsWith('.*')) {
      const prefix = token.slice(0, -2);
      if (!sample.category.startsWith(prefix)) {
        return { match: false, reason: `${sample.category} does not start with ${prefix}` };
      }
      continue;
    }
    if (token !== sample.category) {
      return { match: false, reason: `${token} ≠ ${sample.category}` };
    }
  }
  return { match: true, reason: 'All conditions satisfied' };
}
