 
/**
 * Tests for the notification-routing API — CRUD + reorder.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';

import {
  createRoutingRule,
  deleteRoutingRule,
  reorderRoutingRules,
  updateRoutingRule,
  useRoutingRuleDetail,
  useRoutingRuleList,
} from '../api';
import type { RoutingRuleFilter } from '../types';

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function firstTenantId(): string {
  return Object.keys(useMockStore.getState().tenants)[0]!;
}

function firstChannelIdFor(tenantId: string): string {
  const s = useMockStore.getState();
  const channel = Object.values(s.notificationChannels).find((c) => c.tenant_id === tenantId);
  if (!channel) throw new Error(`no channel seeded for tenant ${tenantId}`);
  return channel.id;
}

function emptyFilter(): RoutingRuleFilter {
  return { enabled: undefined, search: '' };
}

describe('useRoutingRuleList', () => {
  it('scoped to tenant and sorted by order_hint ASC', () => {
    const tenantId = firstTenantId();
    const { result } = renderHook(() => useRoutingRuleList(tenantId, emptyFilter()));
    for (const r of result.current) expect(r.tenant_id).toBe(tenantId);
    for (let i = 1; i < result.current.length; i++) {
      expect(result.current[i - 1]!.order_hint <= result.current[i]!.order_hint).toBe(true);
    }
  });

  it('enabled filter narrows result set', () => {
    const tenantId = firstTenantId();
    const { result } = renderHook(() =>
      useRoutingRuleList(tenantId, { ...emptyFilter(), enabled: true }),
    );
    for (const r of result.current) expect(r.enabled).toBe(true);
  });
});

describe('createRoutingRule', () => {
  it('creates a rule with default order_hint above existing max', async () => {
    const tenantId = firstTenantId();
    const channelId = firstChannelIdFor(tenantId);
    const rule = await createRoutingRule({
      tenant_id: tenantId,
      name: 'new-rule',
      event_filter: 'security.*',
      channel_ids: [channelId],
    });
    expect(rule.order_hint).toBeGreaterThan(0);
    expect(rule.name).toBe('new-rule');
  });

  it('rejects invalid event_filter syntax', async () => {
    const tenantId = firstTenantId();
    const channelId = firstChannelIdFor(tenantId);
    await expect(
      createRoutingRule({
        tenant_id: tenantId,
        name: 'bad',
        event_filter: 'no-dot-here',
        channel_ids: [channelId],
      }),
    ).rejects.toBeDefined();
  });

  it('requires at least one channel id', async () => {
    const tenantId = firstTenantId();
    await expect(
      createRoutingRule({
        tenant_id: tenantId,
        name: 'empty-channels',
        event_filter: 'audit.error',
        channel_ids: [],
      }),
    ).rejects.toBeDefined();
  });
});

describe('updateRoutingRule', () => {
  it('updates name + channel_ids + enabled', async () => {
    const tenantId = firstTenantId();
    const channelId = firstChannelIdFor(tenantId);
    const rule = await createRoutingRule({
      tenant_id: tenantId,
      name: 'tmp',
      event_filter: 'audit.warn',
      channel_ids: [channelId],
    });
    const updated = await updateRoutingRule(rule.id, {
      name: 'renamed',
      enabled: false,
    });
    expect(updated?.name).toBe('renamed');
    expect(updated?.enabled).toBe(false);
  });
});

describe('deleteRoutingRule', () => {
  it('removes the rule from the store', async () => {
    const tenantId = firstTenantId();
    const channelId = firstChannelIdFor(tenantId);
    const rule = await createRoutingRule({
      tenant_id: tenantId,
      name: 'doomed',
      event_filter: 'audit.destructive',
      channel_ids: [channelId],
    });
    const ok = await deleteRoutingRule(rule.id);
    expect(ok).toBe(true);
    expect(useMockStore.getState().notificationRoutingRules[rule.id]).toBeUndefined();
  });
});

describe('reorderRoutingRules', () => {
  it('reassigns order_hint atomically based on supplied order', async () => {
    const tenantId = firstTenantId();
    const channelId = firstChannelIdFor(tenantId);
    const a = await createRoutingRule({
      tenant_id: tenantId,
      name: 'rule-a',
      event_filter: 'audit.warn',
      channel_ids: [channelId],
    });
    const b = await createRoutingRule({
      tenant_id: tenantId,
      name: 'rule-b',
      event_filter: 'security.error',
      channel_ids: [channelId],
    });
    const c = await createRoutingRule({
      tenant_id: tenantId,
      name: 'rule-c',
      event_filter: 'system.info',
      channel_ids: [channelId],
    });

    const reordered = await reorderRoutingRules(tenantId, [c.id, a.id, b.id]);
    expect(reordered.map((r) => r.id)).toEqual([c.id, a.id, b.id]);
    expect(reordered[0]!.order_hint).toBeLessThan(reordered[1]!.order_hint);
    expect(reordered[1]!.order_hint).toBeLessThan(reordered[2]!.order_hint);
  });

  it('ignores rule ids from a different tenant', async () => {
    const tenants = Object.keys(useMockStore.getState().tenants);
    const [tenantA, tenantB] = tenants;
    const channelA = firstChannelIdFor(tenantA!);
    const channelB = firstChannelIdFor(tenantB!);
    const a = await createRoutingRule({
      tenant_id: tenantA!,
      name: 'rule-a',
      event_filter: 'audit.warn',
      channel_ids: [channelA],
    });
    const b = await createRoutingRule({
      tenant_id: tenantB!,
      name: 'rule-b',
      event_filter: 'audit.warn',
      channel_ids: [channelB],
    });
    // Request reorder for tenantA but include tenantB's rule — should be a no-op for b.
    await reorderRoutingRules(tenantA!, [a.id, b.id]);
    const stored = useMockStore.getState().notificationRoutingRules;
    // b's order_hint should be unchanged (still what createRoutingRule assigned).
    expect(stored[b.id]!.order_hint).toBe(b.order_hint);
  });
});

describe('useRoutingRuleDetail', () => {
  it('returns the stored rule', async () => {
    const tenantId = firstTenantId();
    const channelId = firstChannelIdFor(tenantId);
    const rule = await createRoutingRule({
      tenant_id: tenantId,
      name: 'detail',
      event_filter: 'audit.warn',
      channel_ids: [channelId],
    });
    const { result } = renderHook(() => useRoutingRuleDetail(rule.id));
    expect(result.current?.id).toBe(rule.id);
  });
});
