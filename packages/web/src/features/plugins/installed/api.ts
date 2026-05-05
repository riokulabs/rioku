/**
 * Installed plugins API — backed by the Zustand mock store.
 *
 * Selectors pull stable record references from the store and derive arrays
 * outside the selector to avoid the Zustand "snapshot changed every render"
 * infinite-loop trap (see user feedback on stable-selector pattern).
 *
 * Mutations:
 *   - enablePlugin  — flips enabled=true, audit + host event 'plugin:enabled'
 *   - disablePlugin — flips enabled=false, audit + host event 'plugin:disabled'
 *   - uninstallPlugin — removes from store, audit + host event 'plugin:uninstalled'
 *   - installPluginWithProgress — streaming 4-stage install (Plan 6);
 *     returns an EventTarget emitting progress/complete/failed events.
 *   - getBuildLog — reads `last_build_log` for a plugin (Plan 6).
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { Plugin, AuditEntry } from '@/api/resources';
import type { ApprovalCandidate } from '../install-approval/types';
import type { InstalledPluginFilter } from './types';

const nextAuditId = makeIdFactory('audit-plugin');
const nextInstallPluginId = makeIdFactory('plugin-installed');

function now(): string {
  return new Date().toISOString();
}

function currentActor(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function currentTenant(): string | null {
  return useMockStore.getState().currentTenantId;
}

function makeAuditEntry(
  action: string,
  resourceId: string,
  diff?: { before: unknown; after: unknown },
): AuditEntry {
  const entry: AuditEntry = {
    id: nextAuditId(),
    tenant_id: currentTenant(),
    actor_id: currentActor(),
    action,
    resource_type: 'plugin',
    resource_id: resourceId,
    outcome: 'success',
    at: now(),
    tier: 'write',
  };
  if (diff) entry.diff = diff;
  return entry;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * Returns installed plugins. Stage-1 note: seeded plugins are tenant_scope=null
 * (global). The tenant filter is NOT applied in stage 1 — we render all
 * null-scoped globals for the "Installed" tab. A note in the UI explains this.
 */
export function useInstalledPluginList(_tenantId: string, filter: InstalledPluginFilter): Plugin[] {
  const plugins = useMockStore((s) => s.plugins);

  const search = filter.search.toLowerCase().trim();

  const results: Plugin[] = [];
  for (const plugin of Object.values(plugins)) {
    if (filter.enabled === 'enabled' && !plugin.enabled) continue;
    if (filter.enabled === 'disabled' && plugin.enabled) continue;

    if (search) {
      const nameMatch = plugin.display_name.toLowerCase().includes(search);
      const slugMatch = plugin.slug.toLowerCase().includes(search);
      if (!nameMatch && !slugMatch) continue;
    }

    results.push(plugin);
  }

  // Deterministic sort by display name
  return results.sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/** Returns a single plugin record by id (stable reference). */
export function useInstalledPlugin(pluginId: string): Plugin | undefined {
  return useMockStore((s) => s.plugins[pluginId]);
}

/**
 * Returns the last N audit entries for a plugin resource.
 * Pulls the full audit array (stable reference) then filters outside the selector.
 */
export function usePluginAuditTail(pluginId: string, limit = 10): AuditEntry[] {
  const audit = useMockStore((s) => s.audit);
  const filtered: AuditEntry[] = [];
  for (let i = audit.length - 1; i >= 0 && filtered.length < limit; i--) {
    const entry = audit[i];
    if (!entry) continue;
    if (entry.resource_type === 'plugin' && entry.resource_id === pluginId) {
      filtered.push(entry);
    }
  }
  return filtered;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function enablePlugin(pluginId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const plugin = state.plugins[pluginId];
  if (!plugin) return;
  if (plugin.enabled) return;

  state.updateEntity('plugins', pluginId, { enabled: true });
  state.appendAudit(
    makeAuditEntry('plugin:enable', pluginId, {
      before: { enabled: false },
      after: { enabled: true },
    }),
  );
  emitHostEvent('plugin:enabled', {
    plugin_id: pluginId,
    slug: plugin.slug,
    tenant_id: plugin.tenant_scope,
  });
}

export async function disablePlugin(pluginId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const plugin = state.plugins[pluginId];
  if (!plugin) return;
  if (!plugin.enabled) return;

  state.updateEntity('plugins', pluginId, { enabled: false });
  state.appendAudit(
    makeAuditEntry('plugin:disable', pluginId, {
      before: { enabled: true },
      after: { enabled: false },
    }),
  );
  emitHostEvent('plugin:disabled', {
    plugin_id: pluginId,
    slug: plugin.slug,
    tenant_id: plugin.tenant_scope,
  });
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const plugin = state.plugins[pluginId];
  if (!plugin) return;

  state.deleteEntity('plugins', pluginId);
  state.appendAudit(makeAuditEntry('plugin:uninstall', pluginId));
  emitHostEvent('plugin:uninstalled', {
    plugin_id: pluginId,
    slug: plugin.slug,
    tenant_id: plugin.tenant_scope,
  });
}

export function useInstalledPluginMutations() {
  return { enablePlugin, disablePlugin, uninstallPlugin };
}

// ─── Install progress streaming (Plan 6) ──────────────────────────────────────

/** Discrete stages emitted by `installPluginWithProgress`. */
export type InstallProgressStage =
  | 'fetching'
  | 'verifying'
  | 'building'
  | 'swapping'
  | 'complete'
  | 'failed';

/** Payload for the `progress` CustomEvent. */
export interface InstallProgressEvent {
  stage: InstallProgressStage;
  /** Overall progress, 0-100. */
  progress: number;
  /** Human-readable message (appended to the live log tail). */
  message: string;
}

/** Payload for the terminal `complete` CustomEvent. */
export interface InstallCompleteEvent {
  plugin: Plugin;
}

/** Payload for the terminal `failed` CustomEvent. */
export interface InstallFailedEvent {
  /** Stage at which the failure occurred. */
  stage: InstallProgressStage;
  message: string;
  /** Captured build log — stored on the plugin iff the plugin record already exists, otherwise standalone. */
  log: string;
}

/**
 * Emitter returned by `installPluginWithProgress`.
 *
 * Extends EventTarget with a `cancel()` method; the internal interval is
 * cleared and an audit 'plugin:install-cancelled' entry is appended.
 *
 * Event names: 'progress' | 'complete' | 'failed'.
 */
export interface InstallProgressEmitter extends EventTarget {
  cancel(): void;
}

/** djb2 hash used for deterministic failure + stage jitter. */
function hashRef(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** Deterministic per-ref failure flag — 10% failure rate across the input space. */
function shouldFail(ref: string): boolean {
  return hashRef(ref) % 10 === 0;
}

/** Log-line generator per stage — mimics a real xcaddy build output. */
function stageLog(stage: InstallProgressStage, slug: string): string {
  switch (stage) {
    case 'fetching':
      return `[fetch] downloading manifest for ${slug}...`;
    case 'verifying':
      return `[verify] checking cosign signature + SBOM...`;
    case 'building':
      return `[build] xcaddy: compiling ${slug} against caddy v2.8.4...`;
    case 'swapping':
      return `[swap] atomically replacing binary; draining old workers...`;
    case 'complete':
      return `[done] install complete.`;
    case 'failed':
      return `[error] install failed.`;
  }
}

/**
 * Stream a mock install for `candidate`. Returns an emitter on which the
 * caller listens for `progress`, `complete`, and `failed` events.
 *
 * Total duration 4–8 seconds, 4 equal-ish stages (~400ms/tick). 10% chance
 * of deterministic failure keyed on the candidate reference (or slug fallback).
 * On success: a new Plugin is written to the store (mirrors installPlugin).
 * On failure: no plugin is written; the emitted log is also stashed into a
 * module-level map keyed by a synthetic failure id, so the UI can show it.
 *
 * Cancellation: `emitter.cancel()` clears the interval and emits a single
 * audit 'plugin:install-cancelled' entry. No further events are emitted.
 */
export function installPluginWithProgress(candidate: ApprovalCandidate): InstallProgressEmitter {
  const target = new EventTarget() as InstallProgressEmitter;

  // Plan to drive ~12 ticks across 4 stages = 400ms * 12 = ~4.8s total,
  // with a 1x-2x jitter pulled from the ref hash for realism (4-8s total).
  const ref = candidate.reference ?? candidate.slug;
  const refHash = hashRef(ref);
  const tickMs = 380 + (refHash % 80); // 380-460ms
  const stages: Exclude<InstallProgressStage, 'complete' | 'failed'>[] = [
    'fetching',
    'verifying',
    'building',
    'swapping',
  ];
  /** Ticks per stage — 3 ticks each → 12 ticks total. */
  const ticksPerStage = 3;

  const logLines: string[] = [];
  let tickIdx = 0;
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let cancelled = false;
  let failureStage: InstallProgressStage | null = null;

  // Deterministic failure stage — when shouldFail(ref), pick a stage based on
  // the hash so different refs fail at different stages (useful for demos).
  const willFail = shouldFail(ref);
  if (willFail) {
    failureStage = stages[(refHash >> 8) % stages.length] ?? 'building';
  }

  function emitProgress(stage: InstallProgressStage, progress: number, message: string): void {
    logLines.push(message);
    target.dispatchEvent(
      new CustomEvent<InstallProgressEvent>('progress', {
        detail: { stage, progress, message },
      }),
    );
  }

  function stop(): void {
    if (intervalHandle !== null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  function finishSuccess(): void {
    stop();
    if (cancelled) return;

    const state = useMockStore.getState();
    const id = nextInstallPluginId();
    const plugin: Plugin = {
      id,
      tenant_scope: state.currentTenantId,
      slug: candidate.slug,
      display_name: candidate.display_name,
      version: candidate.version,
      enabled: true,
      parts: candidate.parts,
      declared_permissions: candidate.declared_permissions,
      manifest: candidate.manifest ?? { slug: candidate.slug, version: candidate.version },
      has_errors: false,
      build_state: 'stable',
      cosign_verified: true,
    };
    state.addEntity('plugins', plugin);

    const audit: AuditEntry = {
      id: nextAuditId(),
      tenant_id: state.currentTenantId,
      actor_id: state.currentUserId ?? 'unknown',
      action: 'plugin:install',
      resource_type: 'plugin',
      resource_id: id,
      outcome: 'success',
      at: now(),
      tier: 'write',
    };
    state.appendAudit(audit);

    emitHostEvent('plugin:installed', {
      plugin_id: id,
      slug: plugin.slug,
      tenant_id: plugin.tenant_scope,
      source_reference: candidate.reference ?? null,
    });

    target.dispatchEvent(
      new CustomEvent<InstallCompleteEvent>('complete', {
        detail: { plugin },
      }),
    );
  }

  function finishFailure(stage: InstallProgressStage): void {
    stop();
    if (cancelled) return;

    const log = [
      ...logLines,
      `[error] stage '${stage}' failed.`,
      `  at xcaddy:${String(40 + (refHash % 50))}`,
      `  ref=${ref}`,
    ].join('\n');

    const state = useMockStore.getState();
    const audit: AuditEntry = {
      id: nextAuditId(),
      tenant_id: state.currentTenantId,
      actor_id: state.currentUserId ?? 'unknown',
      action: 'plugin:install-failed',
      resource_type: 'plugin',
      outcome: 'error',
      at: now(),
      tier: 'write',
      payload: { slug: candidate.slug, stage, ref },
    };
    state.appendAudit(audit);

    emitHostEvent('plugin:install-failed', {
      slug: candidate.slug,
      tenant_id: state.currentTenantId,
      stage,
      source_reference: candidate.reference ?? null,
    });

    target.dispatchEvent(
      new CustomEvent<InstallFailedEvent>('failed', {
        detail: { stage, message: `Install failed during ${stage}`, log },
      }),
    );
  }

  function tick(): void {
    if (cancelled) return;
    const totalTicks = stages.length * ticksPerStage;
    if (tickIdx >= totalTicks) {
      // Terminal tick — success path (failure already handled inline below).
      emitProgress('complete', 100, stageLog('complete', candidate.slug));
      finishSuccess();
      return;
    }

    const stageIdx = Math.floor(tickIdx / ticksPerStage);
    const stage = stages[stageIdx] ?? 'building';
    const withinStage = tickIdx % ticksPerStage;
    const progress = Math.min(99, Math.floor(((tickIdx + 1) / totalTicks) * 100));

    // If this ref is destined to fail, trip on the first tick of the failure stage.
    if (failureStage !== null && stage === failureStage && withinStage === 0) {
      emitProgress(stage, progress, stageLog(stage, candidate.slug));
      finishFailure(stage);
      return;
    }

    emitProgress(stage, progress, stageLog(stage, candidate.slug));
    tickIdx++;
  }

  intervalHandle = setInterval(tick, tickMs);

  target.cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    stop();
    const state = useMockStore.getState();
    const audit: AuditEntry = {
      id: nextAuditId(),
      tenant_id: state.currentTenantId,
      actor_id: state.currentUserId ?? 'unknown',
      action: 'plugin:install-cancelled',
      resource_type: 'plugin',
      outcome: 'denied',
      at: now(),
      tier: 'write',
      payload: { slug: candidate.slug, ref: candidate.reference ?? null },
    };
    state.appendAudit(audit);
    emitHostEvent('plugin:install-cancelled', {
      slug: candidate.slug,
      tenant_id: state.currentTenantId,
      source_reference: candidate.reference ?? null,
    });
  };

  return target;
}

/** Read the captured build log for a plugin. Returns undefined if none. */
export function getBuildLog(pluginId: string): string | undefined {
  return useMockStore.getState().plugins[pluginId]?.last_build_log;
}
