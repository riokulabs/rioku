/**
 * useHost — single entry point for plugin code to reach all host APIs.
 *
 * Returns a deep-frozen `RiokuHost` object.  Plugins call this inside their
 * components/hooks (or receive it as the default-export argument at register
 * time — see plugin-loader).
 *
 * Rule B4 basis: this interface is the ABI surface. Changes here must bump
 * `CURRENT_ABI_VERSION` in `@/host/abi`. A CI check wires `pnpm check-abi`
 * to enforce this.
 *
 * spec §9.4.1, §9.10.1 B4 / Task 1f.112
 *
 * NOTE: Surface interface definitions live here and are imported by
 * host-builder.ts. This is the single source of truth for the ABI surface —
 * the `/* ABI-SURFACE-START *\/` … `/* ABI-SURFACE-END *\/` markers delimit
 * the block the CI check hashes.
 */

import { useMemo } from 'react';
import { buildHost } from '@/host/host-builder';
import type {
  registerZone,
  unregisterZone,
  getZoneContributions,
  listAllZones,
} from '@/host/zones';
import type { registerRoute, unregisterRoute, listPluginRoutes } from '@/host/routes';
import type {
  registerSidebarEntry,
  unregisterSidebarEntry,
  listSidebarEntries,
} from '@/host/sidebar';
import type {
  registerSettingsPanel,
  unregisterSettingsPanel,
  listSettingsPanels,
} from '@/host/settings';
import type { registerPluginTheme, unregisterPluginTheme, listPluginThemes } from '@/host/themes';
import type {
  registerSpotlightCommand,
  unregisterSpotlightCommand,
  registerSpotlightResource,
  unregisterSpotlightResource,
} from '@/host/spotlight';
import type { setNotifyBackend, emitPluginNotification } from '@/host/notify';
import type { registerWidget, unregisterWidget, listWidgets } from '@/host/widgets';
import type { subscribeHostEvent, useHostEventSubscription } from '@/host/events';
import type {
  registerPluginEndpoint,
  unregisterPluginEndpoint,
  listPluginEndpoints,
} from '@/host/api-endpoints';
import type { registerPluginOpenApi, unregisterPluginOpenApi } from '@/host/openapi';
import type {
  registerPermission,
  unregisterPermission,
  getPermissionRegistry,
} from '@/host/permissions';

// ─── Surface interfaces ───────────────────────────────────────────────────────
// Each interface exposes ONLY the plugin-facing methods.
// Internal registry methods stay in the host/* modules.

/* ABI-SURFACE-START */

export interface HostZones {
  register: typeof registerZone;
  unregister: typeof unregisterZone;
  get: typeof getZoneContributions;
  list: typeof listAllZones;
}

export interface HostRoutes {
  register: typeof registerRoute;
  unregister: typeof unregisterRoute;
  list: typeof listPluginRoutes;
}

export interface HostSidebar {
  register: typeof registerSidebarEntry;
  unregister: typeof unregisterSidebarEntry;
  list: typeof listSidebarEntries;
}

export interface HostSettings {
  register: typeof registerSettingsPanel;
  unregister: typeof unregisterSettingsPanel;
  list: typeof listSettingsPanels;
}

export interface HostThemes {
  register: typeof registerPluginTheme;
  unregister: typeof unregisterPluginTheme;
  list: typeof listPluginThemes;
}

export interface HostSpotlight {
  registerCommand: typeof registerSpotlightCommand;
  unregisterCommand: typeof unregisterSpotlightCommand;
  registerResource: typeof registerSpotlightResource;
  unregisterResource: typeof unregisterSpotlightResource;
}

export interface HostNotify {
  /** Wire a backend (called by first-party providers; plugins do not call this). */
  setBackend: typeof setNotifyBackend;
  /** Emit a notification — the public plugin API. */
  emit: typeof emitPluginNotification;
}

export interface HostWidgets {
  register: typeof registerWidget;
  unregister: typeof unregisterWidget;
  list: typeof listWidgets;
}

export interface HostEvents {
  subscribe: typeof subscribeHostEvent;
  useSubscription: typeof useHostEventSubscription;
}

export interface HostApiEndpoints {
  register: typeof registerPluginEndpoint;
  unregister: typeof unregisterPluginEndpoint;
  list: typeof listPluginEndpoints;
}

export interface HostOpenApi {
  register: typeof registerPluginOpenApi;
  unregister: typeof unregisterPluginOpenApi;
}

export interface HostPermissions {
  register: typeof registerPermission;
  unregister: typeof unregisterPermission;
  getRegistry: typeof getPermissionRegistry;
}

// ─── Root host interface ─────────────────────────────────────────────────────

export interface RiokuHost {
  /** Current ABI version — B4 surface. Any change requires a version bump. */
  abiVersion: number;
  zones: HostZones;
  routes: HostRoutes;
  sidebar: HostSidebar;
  settings: HostSettings;
  themes: HostThemes;
  spotlight: HostSpotlight;
  notify: HostNotify;
  widgets: HostWidgets;
  events: HostEvents;
  apiEndpoints: HostApiEndpoints;
  openapi: HostOpenApi;
  permissions: HostPermissions;
}

/* ABI-SURFACE-END */

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns a deep-frozen, stable `RiokuHost` object.
 *
 * Stable via `useMemo([])` — the host API surface is module-level singletons
 * that don't change across renders.  Plugins should call this hook once at
 * the top level (or receive the host object from the plugin-loader).
 */
export function useHost(): Readonly<RiokuHost> {
  return useMemo<Readonly<RiokuHost>>(() => buildHost(), []);
}
