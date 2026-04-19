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
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { Plugin, AuditEntry } from '@/api/resources/types';
import type { InstalledPluginFilter } from './types';

const nextAuditId = makeIdFactory('audit-plugin');

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
export function useInstalledPluginList(
  _tenantId: string,
  filter: InstalledPluginFilter,
): Plugin[] {
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
