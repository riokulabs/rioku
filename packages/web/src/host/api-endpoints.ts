/**
 * Plugin backend endpoint registry — spec §9.5.10
 *
 * UI-side catalog of what endpoints each plugin's backend half exposes.
 * Used by the OpenAPI explorer and the install-time approval UI to show
 * which backend API surface a plugin requires.
 *
 * Duplicate-path policy: reject same (method + path) combination.
 * Different methods on the same path are allowed (e.g., GET + POST /foo).
 */

import { create } from 'zustand';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface PluginEndpoint {
  path: string;
  method: HttpMethod;
  description?: string;
  /** OAuth-style scopes required to call this endpoint. */
  scopes?: string[];
  source: 'first-party' | 'plugin';
  pluginName?: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface ApiEndpointStore {
  endpoints: PluginEndpoint[];
}

const useApiEndpointStore = create<ApiEndpointStore>()(() => ({ endpoints: [] }));

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Register a plugin backend endpoint.
 * Rejects duplicate (method + path) combinations — warns in dev.
 */
export function registerPluginEndpoint(endpoint: PluginEndpoint): void {
  const existing = useApiEndpointStore
    .getState()
    .endpoints.find((e) => e.method === endpoint.method && e.path === endpoint.path);
  if (existing) {
    if (import.meta.env.DEV) {
      console.warn(
        `[host.api-endpoints] Duplicate endpoint ${endpoint.method} ${endpoint.path} — registration rejected.`,
      );
    }
    return;
  }
  useApiEndpointStore.setState((state) => ({
    endpoints: [...state.endpoints, endpoint],
  }));
}

/** Unregister all endpoints for a given (method + path) pair. No-op if none found. */
export function unregisterPluginEndpoint(method: HttpMethod, path: string): void {
  useApiEndpointStore.setState((state) => ({
    endpoints: state.endpoints.filter(
      (e) => !(e.method === method && e.path === path),
    ),
  }));
}

/**
 * Return all registered plugin endpoints.
 * Optionally filter by pluginName.
 */
export function listPluginEndpoints(pluginName?: string): PluginEndpoint[] {
  const endpoints = useApiEndpointStore.getState().endpoints;
  return pluginName ? endpoints.filter((e) => e.pluginName === pluginName) : endpoints;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** React hook — re-renders when plugin endpoints change. */
export function usePluginEndpoints(pluginName?: string): PluginEndpoint[] {
  return useApiEndpointStore((state) => {
    return pluginName
      ? state.endpoints.filter((e) => e.pluginName === pluginName)
      : state.endpoints;
  });
}
