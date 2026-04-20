/**
 * Notification routing rules API — CRUD + atomic reorder.
 */
import { useMemo } from 'react';

import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type {
  AuditEntry,
  ID,
  NotificationRoutingRule,
} from '@/api/resources/types';

import type {
  CreateRoutingRuleInput,
  RoutingRuleFilter,
  UpdateRoutingRuleInput,
} from './types';
import { createRoutingRuleSchema, updateRoutingRuleSchema } from './schemas';

const nextRuleId = makeIdFactory('rule-new');
const nextAuditId = makeIdFactory('audit-rule');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function currentActor(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function makeAudit(
  action: string,
  tenantId: ID,
  resourceId: ID,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  return {
    id: nextAuditId(),
    tenant_id: tenantId,
    actor_id: currentActor(),
    action,
    resource_type: 'notification-routing-rule',
    resource_id: resourceId,
    outcome: 'success',
    at: now(),
    tier,
  };
}

function matchesFilter(
  rule: NotificationRoutingRule,
  tenantId: ID,
  filter: RoutingRuleFilter,
): boolean {
  if (rule.tenant_id !== tenantId) return false;
  if (filter.enabled !== undefined && rule.enabled !== filter.enabled) return false;
  const search = filter.search.trim().toLowerCase();
  if (search) {
    const hay = `${rule.name} ${rule.event_filter}`.toLowerCase();
    if (!hay.includes(search)) return false;
  }
  return true;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useRoutingRuleList(
  tenantId: ID,
  filter: RoutingRuleFilter,
): NotificationRoutingRule[] {
  const rules = useMockStore((s) => s.notificationRoutingRules);
  return useMemo(() => {
    const out: NotificationRoutingRule[] = [];
    for (const r of Object.values(rules)) {
      if (matchesFilter(r, tenantId, filter)) out.push(r);
    }
    out.sort((a, b) => a.order_hint - b.order_hint);
    return out;
  }, [rules, tenantId, filter]);
}

export function useRoutingRuleDetail(id: ID): NotificationRoutingRule | undefined {
  return useMockStore((s) => s.notificationRoutingRules[id]);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

function nextOrderHintFor(tenantId: ID): number {
  const state = useMockStore.getState();
  let max = 0;
  for (const r of Object.values(state.notificationRoutingRules)) {
    if (r.tenant_id !== tenantId) continue;
    if (r.order_hint > max) max = r.order_hint;
  }
  return max + 100;
}

export async function createRoutingRule(
  input: CreateRoutingRuleInput,
): Promise<NotificationRoutingRule> {
  await simulateLatency('mutation');
  const parsed = createRoutingRuleSchema.parse(input);

  const rule: NotificationRoutingRule = {
    id: nextRuleId(),
    tenant_id: parsed.tenant_id,
    name: parsed.name,
    event_filter: parsed.event_filter,
    channel_ids: parsed.channel_ids,
    enabled: parsed.enabled,
    order_hint: parsed.order_hint ?? nextOrderHintFor(parsed.tenant_id),
    created_at: now(),
  };

  const state = useMockStore.getState();
  state.addEntity('notificationRoutingRules', rule);
  state.appendAudit(
    makeAudit('notification_routing_rule.create', rule.tenant_id, rule.id),
  );
  emitHostEvent('notification-routing:created', {
    rule_id: rule.id,
    tenant_id: rule.tenant_id,
  });
  return rule;
}

export async function updateRoutingRule(
  id: ID,
  input: UpdateRoutingRuleInput,
): Promise<NotificationRoutingRule | undefined> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.notificationRoutingRules[id];
  if (!current) return undefined;

  const parsed = updateRoutingRuleSchema.parse(input);
  const patch: Partial<NotificationRoutingRule> = {};
  if (parsed.name !== undefined) patch.name = parsed.name;
  if (parsed.event_filter !== undefined) patch.event_filter = parsed.event_filter;
  if (parsed.channel_ids !== undefined) patch.channel_ids = parsed.channel_ids;
  if (parsed.enabled !== undefined) patch.enabled = parsed.enabled;
  if (parsed.order_hint !== undefined) patch.order_hint = parsed.order_hint;

  state.updateEntity('notificationRoutingRules', id, patch);
  state.appendAudit(
    makeAudit('notification_routing_rule.update', current.tenant_id, id),
  );
  emitHostEvent('notification-routing:updated', {
    rule_id: id,
    tenant_id: current.tenant_id,
  });
  return useMockStore.getState().notificationRoutingRules[id];
}

export async function deleteRoutingRule(id: ID): Promise<boolean> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.notificationRoutingRules[id];
  if (!current) return false;

  state.deleteEntity('notificationRoutingRules', id);
  state.appendAudit(
    makeAudit('notification_routing_rule.delete', current.tenant_id, id, 'destructive'),
  );
  emitHostEvent('notification-routing:deleted', {
    rule_id: id,
    tenant_id: current.tenant_id,
  });
  return true;
}

/**
 * Reorder rules within a tenant — full-replace of `order_hint` based on the
 * supplied rule-id array (earlier ids get lower order_hint).
 *
 * Atomic: all updates land in a single `setState` call. Rule ids not in
 * `ruleIds` or in a different tenant are left untouched; unknown ids in the
 * input are ignored.
 */
export async function reorderRoutingRules(
  tenantId: ID,
  ruleIds: ID[],
): Promise<NotificationRoutingRule[]> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();

  const patchMap: Record<ID, NotificationRoutingRule> = { ...state.notificationRoutingRules };
  const updatedIds: ID[] = [];
  for (let i = 0; i < ruleIds.length; i++) {
    const id = ruleIds[i]!;
    const current = patchMap[id];
    if (!current) continue;
    if (current.tenant_id !== tenantId) continue;
    patchMap[id] = { ...current, order_hint: (i + 1) * 100 };
    updatedIds.push(id);
  }

  if (updatedIds.length === 0) return [];

  useMockStore.setState(() => ({ notificationRoutingRules: patchMap }));

  state.appendAudit({
    id: nextAuditId(),
    tenant_id: tenantId,
    actor_id: currentActor(),
    action: 'notification_routing_rule.reorder',
    resource_type: 'notification-routing-rule',
    resource_id: tenantId,
    outcome: 'success',
    at: now(),
    tier: 'write',
    payload: { count: updatedIds.length, order: ruleIds },
  });
  emitHostEvent('notification-routing:reordered', {
    tenant_id: tenantId,
    rule_ids: updatedIds,
  });

  const next = useMockStore.getState().notificationRoutingRules;
  return updatedIds
    .map((id) => next[id]!)
    .sort((a, b) => a.order_hint - b.order_hint);
}
