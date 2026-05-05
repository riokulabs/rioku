/**
 * Notification channels API — CRUD + test.
 *
 * Backed by the Zustand mock store. `testChannel` simulates an outbound send
 * with ~800 ms latency and a deterministic ~10% failure rate (hash-based)
 * and writes a synthetic delivery-log entry for observability.
 */
import { useMemo } from 'react';

import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type {
  AuditEntry,
  ID,
  NotificationChannel,
  NotificationDeliveryLogEntry,
} from '@/api/resources';

import { parseChannelConfig } from './schemas';
import type {
  ChannelFilter,
  CreateChannelInput,
  TestChannelResult,
  UpdateChannelInput,
} from './types';

const nextChannelId = makeIdFactory('channel-new');
const nextAuditId = makeIdFactory('audit-channel');
const nextDeliveryId = makeIdFactory('delivery-test');

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
    resource_type: 'notification-channel',
    resource_id: resourceId,
    outcome: 'success',
    at: now(),
    tier,
  };
}

function matchesFilter(channel: NotificationChannel, tenantId: ID, filter: ChannelFilter): boolean {
  if (channel.tenant_id !== tenantId) return false;
  if (filter.kinds.length > 0 && !filter.kinds.includes(channel.kind)) return false;
  if (filter.enabled !== undefined && channel.enabled !== filter.enabled) return false;
  const search = filter.search.trim().toLowerCase();
  if (search && !channel.name.toLowerCase().includes(search)) return false;
  return true;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useChannelList(tenantId: ID, filter: ChannelFilter): NotificationChannel[] {
  const channels = useMockStore((s) => s.notificationChannels);
  return useMemo(() => {
    const out: NotificationChannel[] = [];
    for (const c of Object.values(channels)) {
      if (matchesFilter(c, tenantId, filter)) out.push(c);
    }
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return out;
  }, [channels, tenantId, filter]);
}

export function useChannelDetail(id: ID): NotificationChannel | undefined {
  return useMockStore((s) => s.notificationChannels[id]);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createChannel(input: CreateChannelInput): Promise<NotificationChannel> {
  await simulateLatency('mutation');
  // Per-kind validation so the UI can't persist a broken config.
  const parsedConfig = parseChannelConfig(input.kind, input.config);

  const channel: NotificationChannel = {
    id: nextChannelId(),
    tenant_id: input.tenant_id,
    name: input.name,
    kind: input.kind,
    config: parsedConfig,
    enabled: input.enabled ?? true,
    created_at: now(),
  };

  const state = useMockStore.getState();
  state.addEntity('notificationChannels', channel);
  state.appendAudit(makeAudit('notification_channel.create', channel.tenant_id, channel.id));
  emitHostEvent('notification-channel:created', {
    channel_id: channel.id,
    tenant_id: channel.tenant_id,
    kind: channel.kind,
  });

  return channel;
}

export async function updateChannel(
  id: ID,
  input: UpdateChannelInput,
): Promise<NotificationChannel | undefined> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.notificationChannels[id];
  if (!current) return undefined;

  const patch: Partial<NotificationChannel> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.config !== undefined) {
    patch.config = parseChannelConfig(current.kind, input.config);
  }

  state.updateEntity('notificationChannels', id, patch);
  state.appendAudit(makeAudit('notification_channel.update', current.tenant_id, id));
  emitHostEvent('notification-channel:updated', {
    channel_id: id,
    tenant_id: current.tenant_id,
  });

  return useMockStore.getState().notificationChannels[id];
}

export async function deleteChannel(id: ID): Promise<boolean> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.notificationChannels[id];
  if (!current) return false;

  state.deleteEntity('notificationChannels', id);
  state.appendAudit({
    ...makeAudit('notification_channel.delete', current.tenant_id, id, 'destructive'),
  });
  emitHostEvent('notification-channel:deleted', {
    channel_id: id,
    tenant_id: current.tenant_id,
  });
  return true;
}

// ─── Test ─────────────────────────────────────────────────────────────────────

/**
 * djb2 string hash — deterministic id → integer. Used so `testChannel`
 * failure is repeatable across the same channel id.
 */
function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

const TEST_LATENCY_MS = 800;

/**
 * Simulate a test delivery. ~10% of channel ids fail deterministically (hash
 * mod 10 === 0). Writes a synthetic NotificationDeliveryLog entry tagged with
 * the fake notification id `test:<channel-id>` so the log UI surfaces it.
 */
export async function testChannel(id: ID): Promise<TestChannelResult> {
  const start = Date.now();
  await new Promise<void>((r) => setTimeout(r, TEST_LATENCY_MS));

  const state = useMockStore.getState();
  const channel = state.notificationChannels[id];
  if (!channel) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      tested_at: now(),
      error: 'Channel not found',
    };
  }

  const failBucket = hashCode(id) % 10;
  const ok = failBucket !== 0;
  const testedAt = now();
  const latency = Date.now() - start;
  const logEntry: NotificationDeliveryLogEntry = {
    id: nextDeliveryId(),
    tenant_id: channel.tenant_id,
    channel_id: id,
    notification_id: `test:${id}`,
    status: ok ? 'delivered' : 'failed',
    attempts: ok ? 1 : 3,
    ...(ok
      ? {}
      : {
          error_message: 'Simulated test failure (hash bucket 0)',
          error: 'Simulated test failure (hash bucket 0)',
        }),
    first_attempted_at: testedAt,
    last_attempted_at: testedAt,
    attempted_at: testedAt,
  };
  state.addEntity('notificationDeliveryLog', logEntry);

  state.appendAudit(makeAudit('notification_channel.test', channel.tenant_id, id, 'read'));
  emitHostEvent('notification-channel:tested', {
    channel_id: id,
    tenant_id: channel.tenant_id,
    ok,
  });

  return {
    ok,
    latency_ms: latency,
    tested_at: testedAt,
    ...(ok ? {} : { error: 'Simulated test failure (hash bucket 0)' }),
  };
}
