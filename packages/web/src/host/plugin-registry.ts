/**
 * Plugin registry — dedicated Zustand store tracking installed plugins and
 * their per-surface contributions.
 *
 * Intentionally separate from the API layer (api/).  The plugin loader writes
 * here; surface registries (zones, routes, etc.) are the authoritative stores
 * for rendering — this store is the accounting layer that lets the loader undo
 * everything a plugin registered when it is unloaded.
 *
 * spec §9.5
 */

import { create } from 'zustand';
import type { PluginManifest } from './manifest-schema';

// ─── Contribution shape ───────────────────────────────────────────────────────

export interface PluginContributions {
  zones: { zone: string; id: string }[];
  routes: { path: string; id: string }[];
  sidebar: { id: string }[];
  settings: { id: string }[];
  themes: { name: string }[];
  spotlight: { id: string }[];
  widgets: { type: string }[];
  events: { topic: string; id: string }[];
  apiEndpoints: { path: string }[];
  notifications: { category: string }[];
  permissions: string[];
}

// ─── Installed plugin shape ───────────────────────────────────────────────────

export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  /** ISO timestamp of when the plugin was loaded this session. */
  loadedAt: string;
  /** Surface contributions tracked this session (cleared on unload). */
  contributions: PluginContributions;
}

// ─── Store state + actions ────────────────────────────────────────────────────

interface PluginRegistryState {
  plugins: Record<string, InstalledPlugin>;
}

interface PluginRegistryActions {
  /**
   * Add a plugin to the registry.  If the plugin was already registered,
   * updates its manifest (idempotent re-register) without resetting contributions.
   */
  registerPlugin(manifest: PluginManifest, enabled?: boolean): void;

  /**
   * Remove a plugin from the registry.
   * The caller (plugin loader) is responsible for calling unregister on each
   * surface registry before calling this — see F3 plugin-loader.ts.
   */
  unregisterPlugin(name: string): void;

  /** Toggle a plugin's enabled state. No-op if the plugin is not found. */
  setPluginEnabled(name: string, enabled: boolean): void;

  /**
   * Append an entry to a plugin's contributions for one surface kind.
   * Used by the plugin loader to track what each plugin registered so it can
   * be cleaned up on unload.
   */
  trackContribution<K extends keyof PluginContributions>(
    name: string,
    kind: K,
    entry: PluginContributions[K][number],
  ): void;

  /** Read a single plugin by name. Returns undefined if not found. */
  getPlugin(name: string): InstalledPlugin | undefined;

  /** Return all installed plugins as an array, sorted by name. */
  listPlugins(): InstalledPlugin[];
}

type PluginRegistryStore = PluginRegistryState & PluginRegistryActions;

// ─── Empty contributions factory ─────────────────────────────────────────────

function emptyContributions(): PluginContributions {
  return {
    zones: [],
    routes: [],
    sidebar: [],
    settings: [],
    themes: [],
    spotlight: [],
    widgets: [],
    events: [],
    apiEndpoints: [],
    notifications: [],
    permissions: [],
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const usePluginRegistry = create<PluginRegistryStore>()((set, get) => ({
  plugins: {},

  registerPlugin(manifest, enabled = true) {
    set((state) => {
      const existing = state.plugins[manifest.name];
      return {
        plugins: {
          ...state.plugins,
          [manifest.name]: {
            manifest,
            enabled: existing ? existing.enabled : enabled,
            loadedAt: existing ? existing.loadedAt : new Date().toISOString(),
            contributions: existing ? existing.contributions : emptyContributions(),
          },
        },
      };
    });
  },

  unregisterPlugin(name) {
    set((state) => {
      const next = { ...state.plugins };
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete next[name];
      return { plugins: next };
    });
  },

  setPluginEnabled(name, enabled) {
    set((state) => {
      const plugin = state.plugins[name];
      if (!plugin) return state;
      return {
        plugins: {
          ...state.plugins,
          [name]: { ...plugin, enabled },
        },
      };
    });
  },

  trackContribution<K extends keyof PluginContributions>(
    name: string,
    kind: K,
    entry: PluginContributions[K][number],
  ) {
    set((state) => {
      const plugin = state.plugins[name];
      if (!plugin) return state;
      const existing = plugin.contributions[kind] as PluginContributions[K];
      return {
        plugins: {
          ...state.plugins,
          [name]: {
            ...plugin,
            contributions: {
              ...plugin.contributions,
              [kind]: [...existing, entry],
            },
          },
        },
      };
    });
  },

  getPlugin(name) {
    return get().plugins[name];
  },

  listPlugins() {
    return Object.values(get().plugins).sort((a, b) =>
      a.manifest.name.localeCompare(b.manifest.name),
    );
  },
}));

// ─── Convenience non-hook reads (module-level, for first-party setup) ─────────

export function getPlugin(name: string): InstalledPlugin | undefined {
  return usePluginRegistry.getState().getPlugin(name);
}

export function listPlugins(): InstalledPlugin[] {
  return usePluginRegistry.getState().listPlugins();
}
