/**
 * OpenAPI contribution merge registry.
 *
 * Maintains a catalog of each plugin's contributed OpenAPI spec fragment.
 * `OpenApiSpec` is currently `unknown` — actual merging and Scalar viewer
 * integration are planned. This registry is the plumbing that lets plugins
 * declare their spec and lets the OpenAPI explorer discover it.
 *
 * Duplicate-plugin policy: overwrite with a warning in dev.
 */

import { create } from 'zustand';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Placeholder — full typing deferred to Scalar integration. */
export type OpenApiSpec = unknown;

export interface PluginOpenApiContrib {
  pluginName: string;
  spec: OpenApiSpec;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface OpenApiStore {
  contribs: PluginOpenApiContrib[];
}

const useOpenApiStore = create<OpenApiStore>()(() => ({ contribs: [] }));

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Register a plugin's OpenAPI spec contribution.
 * Overwrites previous contribution from the same plugin (warns in dev).
 */
export function registerPluginOpenApi(contrib: PluginOpenApiContrib): void {
  useOpenApiStore.setState((state) => {
    const existing = state.contribs.find((c) => c.pluginName === contrib.pluginName);
    if (existing && import.meta.env.DEV) {
      console.warn(
        `[host.openapi] Plugin "${contrib.pluginName}" already has an OpenAPI contrib — overwriting.`,
      );
    }
    const contribs = existing
      ? state.contribs.map((c) => (c.pluginName === contrib.pluginName ? contrib : c))
      : [...state.contribs, contrib];
    return { contribs };
  });
}

/** Unregister a plugin's OpenAPI contribution. No-op if not found. */
export function unregisterPluginOpenApi(pluginName: string): void {
  useOpenApiStore.setState((state) => ({
    contribs: state.contribs.filter((c) => c.pluginName !== pluginName),
  }));
}

/** Return all plugin OpenAPI contributions. */
export function listPluginOpenApiContribs(): PluginOpenApiContrib[] {
  return useOpenApiStore.getState().contribs;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** React hook — re-renders when OpenAPI contributions change. */
export function usePluginOpenApiContribs(): PluginOpenApiContrib[] {
  return useOpenApiStore((state) => state.contribs);
}
