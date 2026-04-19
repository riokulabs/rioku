/**
 * useHost — single entry point for plugin code to reach all host APIs.
 *
 * Returns a deep-frozen `RiokuHost` object.  Plugins call this inside their
 * components/hooks (or receive it as the default-export argument at register
 * time — see plugin-loader in F4).
 *
 * Rule B4 basis: this interface is the ABI surface. Changes here must bump
 * `CURRENT_ABI_VERSION` in `@/host/abi`. A CI check (F4) will diff the
 * declared type against the previous ABI snapshot.
 *
 * spec §9.4.1, §9.10.1 B4 / Task 1f.112
 */

import { useMemo } from 'react';
import {
  registerZone,
  unregisterZone,
  getZoneContributions,
  listAllZones,
} from '@/host/zones';
import {
  registerRoute,
  unregisterRoute,
  listPluginRoutes,
} from '@/host/routes';
import {
  registerSidebarEntry,
  unregisterSidebarEntry,
  listSidebarEntries,
} from '@/host/sidebar';
import {
  registerSettingsPanel,
  unregisterSettingsPanel,
  listSettingsPanels,
} from '@/host/settings';
import {
  registerPluginTheme,
  unregisterPluginTheme,
  listPluginThemes,
} from '@/host/themes';
import {
  registerSpotlightCommand,
  unregisterSpotlightCommand,
  registerSpotlightResource,
  unregisterSpotlightResource,
} from '@/host/spotlight';
import { setNotifyBackend, emitPluginNotification } from '@/host/notify';
import {
  registerWidget,
  unregisterWidget,
  listWidgets,
} from '@/host/widgets';
import {
  subscribeHostEvent,
  useHostEventSubscription,
} from '@/host/events';
import {
  registerPluginEndpoint,
  unregisterPluginEndpoint,
  listPluginEndpoints,
} from '@/host/api-endpoints';
import {
  registerPluginOpenApi,
  unregisterPluginOpenApi,
} from '@/host/openapi';
import {
  registerPermission,
  unregisterPermission,
  getPermissionRegistry,
} from '@/host/permissions';
import { CURRENT_ABI_VERSION } from '@/host/abi';

// ─── Surface interfaces ───────────────────────────────────────────────────────
// Each interface exposes ONLY the plugin-facing methods.
// Internal registry methods stay in the host/* modules.

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

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns a deep-frozen, stable `RiokuHost` object.
 *
 * Stable via `useMemo([])` — the host API surface is module-level singletons
 * that don't change across renders.  Plugins should call this hook once at
 * the top level (or receive the host object from the plugin-loader).
 */
export function useHost(): Readonly<RiokuHost> {
  return useMemo<Readonly<RiokuHost>>(() => {
    const zones: HostZones = Object.freeze({
      register: registerZone,
      unregister: unregisterZone,
      get: getZoneContributions,
      list: listAllZones,
    });

    const routes: HostRoutes = Object.freeze({
      register: registerRoute,
      unregister: unregisterRoute,
      list: listPluginRoutes,
    });

    const sidebar: HostSidebar = Object.freeze({
      register: registerSidebarEntry,
      unregister: unregisterSidebarEntry,
      list: listSidebarEntries,
    });

    const settings: HostSettings = Object.freeze({
      register: registerSettingsPanel,
      unregister: unregisterSettingsPanel,
      list: listSettingsPanels,
    });

    const themes: HostThemes = Object.freeze({
      register: registerPluginTheme,
      unregister: unregisterPluginTheme,
      list: listPluginThemes,
    });

    const spotlight: HostSpotlight = Object.freeze({
      registerCommand: registerSpotlightCommand,
      unregisterCommand: unregisterSpotlightCommand,
      registerResource: registerSpotlightResource,
      unregisterResource: unregisterSpotlightResource,
    });

    const notify: HostNotify = Object.freeze({
      setBackend: setNotifyBackend,
      emit: emitPluginNotification,
    });

    const widgets: HostWidgets = Object.freeze({
      register: registerWidget,
      unregister: unregisterWidget,
      list: listWidgets,
    });

    const events: HostEvents = Object.freeze({
      subscribe: subscribeHostEvent,
      useSubscription: useHostEventSubscription,
    });

    const apiEndpoints: HostApiEndpoints = Object.freeze({
      register: registerPluginEndpoint,
      unregister: unregisterPluginEndpoint,
      list: listPluginEndpoints,
    });

    const openapi: HostOpenApi = Object.freeze({
      register: registerPluginOpenApi,
      unregister: unregisterPluginOpenApi,
    });

    const permissions: HostPermissions = Object.freeze({
      register: registerPermission,
      unregister: unregisterPermission,
      getRegistry: getPermissionRegistry,
    });

    return Object.freeze<RiokuHost>({
      abiVersion: CURRENT_ABI_VERSION,
      zones,
      routes,
      sidebar,
      settings,
      themes,
      spotlight,
      notify,
      widgets,
      events,
      apiEndpoints,
      openapi,
      permissions,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
