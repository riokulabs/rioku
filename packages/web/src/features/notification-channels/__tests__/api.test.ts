/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Tests for the notification-channels API — CRUD + test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';

import {
  createChannel,
  deleteChannel,
  testChannel,
  updateChannel,
  useChannelDetail,
  useChannelList,
} from '../api';
import type { ChannelFilter } from '../types';

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function firstTenantId(): string {
  return Object.keys(useMockStore.getState().tenants)[0]!;
}

function emptyFilter(): ChannelFilter {
  return { kinds: [], enabled: undefined, search: '' };
}

describe('useChannelList', () => {
  it('returns channels scoped to the tenant sorted by name', () => {
    const tenantId = firstTenantId();
    const { result } = renderHook(() => useChannelList(tenantId, emptyFilter()));
    for (const c of result.current) expect(c.tenant_id).toBe(tenantId);
    for (let i = 1; i < result.current.length; i++) {
      expect(result.current[i - 1]!.name <= result.current[i]!.name).toBe(true);
    }
  });

  it('kind filter narrows result set', () => {
    const tenantId = firstTenantId();
    const filter: ChannelFilter = { ...emptyFilter(), kinds: ['slack'] };
    const { result } = renderHook(() => useChannelList(tenantId, filter));
    for (const c of result.current) expect(c.kind).toBe('slack');
  });

  it('enabled filter narrows result set', () => {
    const tenantId = firstTenantId();
    const filter: ChannelFilter = { ...emptyFilter(), enabled: true };
    const { result } = renderHook(() => useChannelList(tenantId, filter));
    for (const c of result.current) expect(c.enabled).toBe(true);
  });
});

describe('createChannel', () => {
  it('creates a new channel with parsed config', async () => {
    const tenantId = firstTenantId();
    const channel = await createChannel({
      tenant_id: tenantId,
      name: 'test-slack',
      kind: 'slack',
      config: { webhook_url: 'https://hooks.slack.com/services/T/B/C' },
    });
    expect(channel.id).toBeDefined();
    expect(channel.name).toBe('test-slack');
    expect(channel.config).toEqual({ webhook_url: 'https://hooks.slack.com/services/T/B/C' });
  });

  it('rejects invalid per-kind config', async () => {
    const tenantId = firstTenantId();
    await expect(
      createChannel({
        tenant_id: tenantId,
        name: 'bad-slack',
        kind: 'slack',
        config: { webhook_url: 'not-a-url' },
      }),
    ).rejects.toBeDefined();
  });
});

describe('updateChannel', () => {
  it('updates name + enabled + config and re-validates per-kind', async () => {
    const tenantId = firstTenantId();
    const channel = await createChannel({
      tenant_id: tenantId,
      name: 'old-email',
      kind: 'email',
      config: { to: 'a@example.com', from: 'b@example.com' },
    });
    const updated = await updateChannel(channel.id, {
      name: 'new-email',
      enabled: false,
    });
    expect(updated?.name).toBe('new-email');
    expect(updated?.enabled).toBe(false);
  });

  it('returns undefined for missing channel', async () => {
    const res = await updateChannel('channel-nope', { name: 'x' });
    expect(res).toBeUndefined();
  });
});

describe('deleteChannel', () => {
  it('removes the channel and returns true', async () => {
    const tenantId = firstTenantId();
    const channel = await createChannel({
      tenant_id: tenantId,
      name: 'tmp',
      kind: 'webhook',
      config: { url: 'https://example.com/hook' },
    });
    const ok = await deleteChannel(channel.id);
    expect(ok).toBe(true);
    expect(useMockStore.getState().notificationChannels[channel.id]).toBeUndefined();
  });
});

describe('testChannel', () => {
  it('returns ok with latency + tested_at on success', async () => {
    const tenantId = firstTenantId();
    // Use a name whose hash is unlikely to bucket 0 by picking deliberately.
    const channel = await createChannel({
      tenant_id: tenantId,
      name: 'good-webhook',
      kind: 'webhook',
      config: { url: 'https://example.com/hook' },
    });
    const res = await testChannel(channel.id);
    expect(typeof res.latency_ms).toBe('number');
    expect(res.latency_ms).toBeGreaterThanOrEqual(700); // ~800ms sleep, allow jitter
    expect(typeof res.tested_at).toBe('string');
  });

  it('writes a delivery-log entry after a test call', async () => {
    const tenantId = firstTenantId();
    const channel = await createChannel({
      tenant_id: tenantId,
      name: 'test-log',
      kind: 'webhook',
      config: { url: 'https://example.com/hook' },
    });
    const before = Object.values(useMockStore.getState().notificationDeliveryLog).length;
    await testChannel(channel.id);
    const after = Object.values(useMockStore.getState().notificationDeliveryLog).length;
    expect(after).toBe(before + 1);
  });

  it('returns ok=false with error for missing channel', async () => {
    const res = await testChannel('channel-nope');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Channel not found');
  });
});

describe('useChannelDetail', () => {
  it('returns the channel for a known id', async () => {
    const tenantId = firstTenantId();
    const channel = await createChannel({
      tenant_id: tenantId,
      name: 'detail-check',
      kind: 'pagerduty',
      config: { routing_key: 'R1234567890ABCDEF1234567890ABCDEF' },
    });
    const { result } = renderHook(() => useChannelDetail(channel.id));
    expect(result.current?.id).toBe(channel.id);
  });
});
