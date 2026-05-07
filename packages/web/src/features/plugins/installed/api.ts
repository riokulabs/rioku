/**
 * Installed plugins API — Stage-2 (real daemon endpoints).
 *
 * Routes:
 *   GET    /api/v1/t/{tenant}/plugins                — list installed plugins
 *   GET    /api/v1/t/{tenant}/plugins/{id}           — single plugin
 *   POST   /api/v1/t/{tenant}/plugins/{id}/enable    — enable
 *   POST   /api/v1/t/{tenant}/plugins/{id}/disable   — disable
 *   DELETE /api/v1/t/{tenant}/plugins/{id}           — uninstall
 *   POST   /api/v1/t/{tenant}/plugins/install        — install from candidate
 *   GET    /api/v1/t/{tenant}/plugins/{id}/build-log — build log (text)
 *   SSE    /api/v1/t/{tenant}/plugins/{id}/build-log/stream — live progress
 *
 * Selectors return plain arrays/records derived from useQuery so existing
 * component code paths (which never touched react-query state directly)
 * keep working. Mutations go through bare async helpers exposed for the
 * "imperative" callers, plus useMutation hooks for component callers.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';
import type { Plugin, AuditEntry } from '@/api/resources';

const SSE_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';
import type { ApprovalCandidate } from '../install-approval/types';
import type { InstalledPluginFilter } from './types';

// ─── Daemon wire shapes ──────────────────────────────────────────────────────

interface DaemonPluginListResponse {
  items: DaemonPlugin[];
  total: number;
}

interface DaemonPlugin {
  id: string;
  tenantScope: string | null;
  slug: string;
  name: string;
  version: string;
  enabled: boolean;
  buildState: string;
  cosignVerified: boolean;
  signerId: string | null;
  config: unknown;
  metadata: unknown;
  installedAt: string;
  updatedAt: string;
}

function daemonToPlugin(d: DaemonPlugin): Plugin {
  const out: Plugin = {
    id: d.id,
    tenant_scope: d.tenantScope ?? null,
    slug: d.slug,
    display_name: d.name,
    version: d.version,
    enabled: d.enabled,
    parts: [],
    declared_permissions: [],
    manifest: {},
    has_errors: d.buildState === 'failed',
    build_state: d.buildState as Plugin['build_state'],
    cosign_verified: d.cosignVerified,
  };
  if (d.signerId !== null) out.signer_id = d.signerId;
  return out;
}

// ─── URL builders ────────────────────────────────────────────────────────────

function pluginsUrl(tenantId: string): string {
  return `/t/${tenantId}/plugins`;
}

function pluginUrl(tenantId: string, id: string): string {
  return `/t/${tenantId}/plugins/${id}`;
}

// ─── Query keys ──────────────────────────────────────────────────────────────

export const pluginQueryKeys = {
  list: (tenantId: string) => ['plugins', 'list', tenantId] as const,
  detail: (tenantId: string, id: string) => ['plugins', 'detail', tenantId, id] as const,
  buildLog: (tenantId: string, id: string) => ['plugins', 'build-log', tenantId, id] as const,
} as const;

// ─── Selectors ───────────────────────────────────────────────────────────────

/**
 * Returns installed plugins. Applies search + enabled filtering client-side.
 *
 * `tenantId` is required and is forwarded to the tenant-scoped listing
 * endpoint. The empty string is treated as "no tenant" and returns [].
 */
export function useInstalledPluginList(tenantId: string, filter: InstalledPluginFilter): Plugin[] {
  const { data } = useQuery({
    queryKey: pluginQueryKeys.list(tenantId),
    queryFn: async ({ signal }) => {
      const resp = await customFetch<DaemonPluginListResponse>({
        url: pluginsUrl(tenantId),
        method: 'GET',
        signal,
      });
      return resp.items.map(daemonToPlugin);
    },
    staleTime: 30_000,
    enabled: tenantId !== '',
  });
  const plugins = data ?? [];

  const search = filter.search.toLowerCase().trim();
  const filtered: Plugin[] = [];
  for (const plugin of plugins) {
    if (filter.enabled === 'enabled' && !plugin.enabled) continue;
    if (filter.enabled === 'disabled' && plugin.enabled) continue;
    if (search) {
      const nameMatch = plugin.display_name.toLowerCase().includes(search);
      const slugMatch = plugin.slug.toLowerCase().includes(search);
      if (!nameMatch && !slugMatch) continue;
    }
    filtered.push(plugin);
  }
  return filtered.sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/** Returns a single plugin record by id. */
export function useInstalledPlugin(pluginId: string, tenantId = ''): Plugin | undefined {
  const { data } = useQuery({
    queryKey: pluginQueryKeys.detail(tenantId, pluginId),
    queryFn: async ({ signal }) => {
      const resp = await customFetch<DaemonPlugin>({
        url: pluginUrl(tenantId, pluginId),
        method: 'GET',
        signal,
      });
      return daemonToPlugin(resp);
    },
    enabled: tenantId !== '' && !!pluginId,
    staleTime: 30_000,
  });
  return data;
}

/**
 * Returns the last N audit entries for a plugin resource.
 *
 * Stage-2 placeholder: the daemon's per-resource audit is not yet
 * exposed via REST under the plugin path. Until the audit query
 * endpoint accepts resource_type+resource_id filters, this hook
 * returns an empty array; consumers degrade gracefully.
 */
export function usePluginAuditTail(_pluginId: string, _limit = 10): AuditEntry[] {
  return [];
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Enable a plugin. Hits POST /plugins/{id}/enable. Throws on non-2xx.
 *
 * `tenantId` is required for the real endpoint. Callers from legacy
 * imperative code paths can pass '' to no-op; this matches the previous
 * mock-store behaviour that silently dropped the call.
 */
export async function enablePlugin(pluginId: string, tenantId = ''): Promise<void> {
  if (tenantId === '') return;
  await customFetch<unknown>({
    url: `${pluginUrl(tenantId, pluginId)}/enable`,
    method: 'POST',
  });
}

export async function disablePlugin(pluginId: string, tenantId = ''): Promise<void> {
  if (tenantId === '') return;
  await customFetch<unknown>({
    url: `${pluginUrl(tenantId, pluginId)}/disable`,
    method: 'POST',
  });
}

export async function uninstallPlugin(pluginId: string, tenantId = ''): Promise<void> {
  if (tenantId === '') return;
  await customFetch<unknown>({
    url: pluginUrl(tenantId, pluginId),
    method: 'DELETE',
  });
}

/**
 * Returns imperative mutation helpers — kept for backward compatibility
 * with components that don't use TanStack Query mutation hooks. Each
 * helper takes a `tenantId` argument; the no-tenant call is a no-op.
 */
export function useInstalledPluginMutations() {
  return { enablePlugin, disablePlugin, uninstallPlugin };
}

/**
 * TanStack Query mutation hooks — preferred entry points for component
 * code. They invalidate the list cache on success so the UI refreshes.
 */
export function useEnablePluginMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pluginId: string) => enablePlugin(pluginId, tenantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pluginQueryKeys.list(tenantId) });
    },
  });
}

export function useDisablePluginMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pluginId: string) => disablePlugin(pluginId, tenantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pluginQueryKeys.list(tenantId) });
    },
  });
}

export function useUninstallPluginMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pluginId: string) => uninstallPlugin(pluginId, tenantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pluginQueryKeys.list(tenantId) });
    },
  });
}

// ─── Install progress streaming (Stage 2 — SSE) ──────────────────────────────

/** Discrete stages emitted by `installPluginWithProgress`. */
export type InstallProgressStage =
  | 'fetching'
  | 'verifying'
  | 'building'
  | 'swapping'
  | 'complete'
  | 'failed';

export interface InstallProgressEvent {
  stage: InstallProgressStage;
  /** Overall progress, 0-100. */
  progress: number;
  /** Human-readable message (appended to the live log tail). */
  message: string;
}

export interface InstallCompleteEvent {
  plugin: Plugin;
}

export interface InstallFailedEvent {
  stage: InstallProgressStage;
  message: string;
  /** Captured build log. */
  log: string;
}

export interface InstallProgressEmitter extends EventTarget {
  cancel(): void;
}

/**
 * Subscribes to the daemon's install SSE stream for `candidate` and
 * relays progress events on the returned EventTarget.
 *
 * Wire protocol: the daemon emits SSE events of type `progress`,
 * `complete`, and `failed`. Each event's data is a JSON envelope with
 * a `stage`, `progress` (0-100), and `message` field; `complete`
 * additionally carries a `plugin` object, and `failed` carries a
 * `log` string.
 *
 * The `tenantSlug` argument is required — empty string skips the
 * subscription and returns an inert emitter that emits nothing.
 */
export function installPluginWithProgress(
  candidate: ApprovalCandidate,
  tenantSlug = '',
): InstallProgressEmitter {
  const target = new EventTarget() as InstallProgressEmitter;
  let cancelled = false;
  let es: EventSource | null = null;

  /** Parse one SSE event's `data` JSON payload, defensively. */
  function parseDetail(raw: string): Record<string, unknown> {
    try {
      const v = JSON.parse(raw) as unknown;
      if (v && typeof v === 'object') return v as Record<string, unknown>;
    } catch {
      // fall through
    }
    return {};
  }

  if (tenantSlug !== '') {
    void customFetch<{ installId: string }>({
      url: `/t/${tenantSlug}/plugins/install`,
      method: 'POST',
      data: {
        slug: candidate.slug,
        version: candidate.version,
        reference: candidate.reference,
      },
    })
      .then((resp) => {
        if (cancelled || !resp.installId) return;
        const url = `${SSE_BASE}/t/${tenantSlug}/plugins/install/${resp.installId}/stream`;
        es = new EventSource(url, { withCredentials: true });

        const safeStr = (v: unknown, fallback: string): string =>
          typeof v === 'string' ? v : fallback;

        es.addEventListener('progress', (ev: MessageEvent) => {
          const detail = parseDetail(ev.data as string);
          target.dispatchEvent(
            new CustomEvent<InstallProgressEvent>('progress', {
              detail: {
                stage: safeStr(detail.stage, 'fetching') as InstallProgressStage,
                progress: typeof detail.progress === 'number' ? detail.progress : 0,
                message: safeStr(detail.message, ''),
              },
            }),
          );
        });
        es.addEventListener('complete', (ev: MessageEvent) => {
          const detail = parseDetail(ev.data as string);
          target.dispatchEvent(
            new CustomEvent<InstallCompleteEvent>('complete', {
              detail: { plugin: detail.plugin as Plugin },
            }),
          );
          if (es) {
            es.close();
            es = null;
          }
        });
        es.addEventListener('failed', (ev: MessageEvent) => {
          const detail = parseDetail(ev.data as string);
          target.dispatchEvent(
            new CustomEvent<InstallFailedEvent>('failed', {
              detail: {
                stage: safeStr(detail.stage, 'failed') as InstallProgressStage,
                message: safeStr(detail.message, 'Install failed'),
                log: safeStr(detail.log, ''),
              },
            }),
          );
          if (es) {
            es.close();
            es = null;
          }
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        target.dispatchEvent(
          new CustomEvent<InstallFailedEvent>('failed', {
            detail: {
              stage: 'fetching',
              message: err instanceof Error ? err.message : 'Install request failed',
              log: '',
            },
          }),
        );
      });
  }

  target.cancel = (): void => {
    cancelled = true;
    if (es) {
      es.close();
      es = null;
    }
  };

  return target;
}

/**
 * Read the captured build log for a plugin. Hits the
 * `/plugins/{id}/build-log` endpoint and returns the body as text.
 * Returns undefined when the daemon returns 404 or the call fails.
 */
export async function getBuildLog(
  pluginId: string,
  tenantId = '',
): Promise<string | undefined> {
  if (tenantId === '' || pluginId === '') return undefined;
  try {
    return await customFetch<string>({
      url: `${pluginUrl(tenantId, pluginId)}/build-log`,
      method: 'GET',
    });
  } catch {
    return undefined;
  }
}
