/**
 * Notification channels API — CRUD + test (stage-2, daemon-backed).
 *
 * Routes (per `notification-routes.go`):
 *   GET    /api/v1/t/{tenant}/notification-channels         list
 *   POST   /api/v1/t/{tenant}/notification-channels         create
 *   GET    /api/v1/t/{tenant}/notification-channels/{id}    detail
 *   PUT    /api/v1/t/{tenant}/notification-channels/{id}    update
 *   DELETE /api/v1/t/{tenant}/notification-channels/{id}    delete
 *   POST   /api/v1/t/{tenant}/notification-channels/{id}/test   send a test
 *
 * Selectors return shape-compatible {@link NotificationChannel} objects so
 * existing components keep working unchanged.
 *
 * Per stage-2 plan-06: non-email channel kinds are surfaced in the UI but
 * tagged as "Coming soon" — the daemon dispatcher only implements email
 * delivery in the first stage-2 cut.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveTenant } from '@/features/notifications/api';
import { customFetch } from '@/api/mutator';
import { emitHostEvent } from '@/host/events';
import type { ID, NotificationChannel } from '@/api/resources';

import { parseChannelConfig } from './schemas';
import type {
  ChannelFilter,
  CreateChannelInput,
  TestChannelResult,
  UpdateChannelInput,
} from './types';

// ─── Daemon DTO + mapper ──────────────────────────────────────────────────────

interface DaemonChannel {
  id: string;
  tenantId: string;
  name: string;
  kind: NotificationChannel['kind'];
  config: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ListChannelsResponse {
  items: DaemonChannel[];
  total: number;
}

function mapChannel(d: DaemonChannel): NotificationChannel {
  return {
    id: d.id,
    tenant_id: d.tenantId,
    name: d.name,
    kind: d.kind,
    config: d.config ?? {},
    enabled: d.enabled,
    created_at: d.createdAt,
  };
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const channelKeys = {
  all: (tenant: string) => ['notification-channels', tenant] as const,
  list: (tenant: string) => ['notification-channels', tenant, 'list'] as const,
  detail: (tenant: string, id: string) => ['notification-channels', tenant, id] as const,
};

// ─── Filtering (client-side) ──────────────────────────────────────────────────

function matchesFilter(channel: NotificationChannel, filter: ChannelFilter): boolean {
  if (filter.kinds.length > 0 && !filter.kinds.includes(channel.kind)) return false;
  if (filter.enabled !== undefined && channel.enabled !== filter.enabled) return false;
  const search = filter.search.trim().toLowerCase();
  if (search && !channel.name.toLowerCase().includes(search)) return false;
  return true;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

async function fetchChannels(tenant: string): Promise<NotificationChannel[]> {
  const data = await customFetch<ListChannelsResponse>({
    url: `/t/${tenant}/notification-channels`,
    method: 'GET',
  });
  const items = data.items.map(mapChannel);
  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return items;
}

/**
 * List channels for the current tenant, filtered client-side.
 * `tenantId` is preserved for API compatibility but the daemon scopes by
 * the URL tenant slug — the underlying store filter still narrows to the
 * matching `tenant_id` for defense-in-depth.
 */
export function useChannelList(tenantId: ID, filter: ChannelFilter): NotificationChannel[] {
  const tenant = resolveTenant();
  const { data } = useQuery({
    queryKey: channelKeys.list(tenant),
    queryFn: () => fetchChannels(tenant),
    staleTime: 30_000,
    enabled: !!tenant,
  });
  const items = data ?? [];
  return items.filter((c) => (!tenantId || c.tenant_id === tenantId) && matchesFilter(c, filter));
}

export function useChannelDetail(id: ID): NotificationChannel | undefined {
  const tenant = resolveTenant();
  const { data } = useQuery({
    queryKey: channelKeys.detail(tenant, id),
    queryFn: () =>
      customFetch<DaemonChannel>({
        url: `/t/${tenant}/notification-channels/${id}`,
        method: 'GET',
      }).then(mapChannel),
    staleTime: 30_000,
    enabled: !!tenant && !!id,
  });
  return data;
}

// ─── Cache invalidation helper ────────────────────────────────────────────────

function invalidateChannelCache(tenant: string): void {
  // NB: queries imported from the React-Query default client. Using window's
  // global queryClient if present is brittle in tests; instead components
  // and mutations call invalidate via React Query.
  // We use the lightweight fact that `useQueryClient` is only available
  // inside React. From a free function, callers should refresh via the
  // returned promise — but in practice the hooks above re-run on stale-time.
  // Provide a no-op fallback so this remains side-effect-only.
  void tenant;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createChannel(input: CreateChannelInput): Promise<NotificationChannel> {
  const tenant = resolveTenant();
  // Per-kind validation so the UI can't persist a broken config.
  const parsedConfig = parseChannelConfig(input.kind, input.config);
  const data = await customFetch<DaemonChannel>({
    url: `/t/${tenant}/notification-channels`,
    method: 'POST',
    data: {
      name: input.name,
      kind: input.kind,
      config: parsedConfig,
      enabled: input.enabled ?? true,
    },
  });
  emitHostEvent('notification-channel:created', {
    channel_id: data.id,
    tenant_id: data.tenantId,
    kind: data.kind,
  });
  invalidateChannelCache(tenant);
  return mapChannel(data);
}

export async function updateChannel(
  id: ID,
  input: UpdateChannelInput,
): Promise<NotificationChannel | undefined> {
  const tenant = resolveTenant();
  // We need the current kind to validate config patches; fetch detail first
  // when config is in the patch.
  let validatedConfig: Record<string, unknown> | undefined;
  if (input.config !== undefined) {
    const current = await customFetch<DaemonChannel>({
      url: `/t/${tenant}/notification-channels/${id}`,
      method: 'GET',
    }).catch(() => null);
    if (!current) return undefined;
    validatedConfig = parseChannelConfig(current.kind, input.config);
  }
  try {
    const data = await customFetch<DaemonChannel>({
      url: `/t/${tenant}/notification-channels/${id}`,
      method: 'PUT',
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(validatedConfig !== undefined ? { config: validatedConfig } : {}),
      },
    });
    emitHostEvent('notification-channel:updated', {
      channel_id: data.id,
      tenant_id: data.tenantId,
    });
    invalidateChannelCache(tenant);
    return mapChannel(data);
  } catch {
    return undefined;
  }
}

export async function deleteChannel(id: ID): Promise<boolean> {
  const tenant = resolveTenant();
  try {
    await customFetch<unknown>({
      url: `/t/${tenant}/notification-channels/${id}`,
      method: 'DELETE',
    });
    emitHostEvent('notification-channel:deleted', { channel_id: id });
    invalidateChannelCache(tenant);
    return true;
  } catch {
    return false;
  }
}

// ─── Test ─────────────────────────────────────────────────────────────────────

interface DaemonTestResponse {
  channelId: string;
  ok: boolean;
  note?: string;
  error?: string;
  latencyMs?: number;
}

/**
 * Send a real test notification through the daemon.
 *
 * Hits POST /api/v1/t/{tenant}/notification-channels/{id}/test which loads
 * the channel, dispatches a synthetic "test" message via the channel-send
 * dispatcher (with retry + delivery-log writes), and returns
 * `{ ok, deliveredAt }` on success or a problem-detail body with HTTP 502
 * on send failure.
 */
export async function testChannel(id: ID): Promise<TestChannelResult> {
  const tenant = resolveTenant();
  const start = Date.now();
  const testedAt = new Date().toISOString();
  try {
    const data = await customFetch<DaemonTestResponse>({
      url: `/t/${tenant}/notification-channels/${id}/test`,
      method: 'POST',
    });
    emitHostEvent('notification-channel:tested', {
      channel_id: id,
      ok: data.ok,
    });
    return {
      ok: data.ok,
      latency_ms: data.latencyMs ?? Date.now() - start,
      tested_at: testedAt,
      ...(data.ok ? {} : { error: data.error ?? data.note ?? 'Test failed' }),
    };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      tested_at: testedAt,
      error: err instanceof Error ? err.message : 'Channel not found',
    };
  }
}

// ─── Cache invalidation re-export for components ──────────────────────────────

/**
 * Hook helper — returns a callback that invalidates all notification-channel
 * queries for the active tenant. Used by mutation onSuccess paths in pages
 * that already render under a QueryClientProvider.
 */
export function useInvalidateChannels(): () => void {
  const qc = useQueryClient();
  const tenant = resolveTenant();
  return () => {
    void qc.invalidateQueries({ queryKey: channelKeys.all(tenant) });
  };
}
