/**
 * Host builder — shared factory used by both `useHost` (React hook) and the
 * plugin-loader singleton (non-React context).
 *
 * DRY: previously the host object was constructed inline in `useHost`. Extracting
 * `buildHost()` here means both paths produce the exact same frozen shape.
 *
 * spec §9.4.1
 */

import { registerZone, unregisterZone, getZoneContributions, listAllZones } from '@/host/zones';
import { registerRoute, unregisterRoute, listPluginRoutes } from '@/host/routes';
import { registerSidebarEntry, unregisterSidebarEntry, listSidebarEntries } from '@/host/sidebar';
import {
  registerSettingsPanel,
  unregisterSettingsPanel,
  listSettingsPanels,
} from '@/host/settings';
import { registerPluginTheme, unregisterPluginTheme, listPluginThemes } from '@/host/themes';
import {
  registerSpotlightCommand,
  unregisterSpotlightCommand,
  registerSpotlightResource,
  unregisterSpotlightResource,
} from '@/host/spotlight';
import { setNotifyBackend, emitPluginNotification } from '@/host/notify';
import { registerWidget, unregisterWidget, listWidgets } from '@/host/widgets';
import { subscribeHostEvent, useHostEventSubscription } from '@/host/events';
import {
  registerPluginEndpoint,
  unregisterPluginEndpoint,
  listPluginEndpoints,
} from '@/host/api-endpoints';
import { registerPluginOpenApi, unregisterPluginOpenApi } from '@/host/openapi';
import {
  registerPermission,
  unregisterPermission,
  getPermissionRegistry,
} from '@/host/permissions';
import { CURRENT_ABI_VERSION } from '@/host/abi';
import type { RiokuHost } from '@/hooks/use-host';

/**
 * Build a deep-frozen `RiokuHost` object.
 *
 * This is the authoritative factory for all host instances — both the React
 * hook (`useHost`) and the plugin-loader singleton call this.
 */
export function buildHost(): Readonly<RiokuHost> {
  return Object.freeze<RiokuHost>({
    abiVersion: CURRENT_ABI_VERSION,

    zones: Object.freeze({
      register: registerZone,
      unregister: unregisterZone,
      get: getZoneContributions,
      list: listAllZones,
    }),

    routes: Object.freeze({
      register: registerRoute,
      unregister: unregisterRoute,
      list: listPluginRoutes,
    }),

    sidebar: Object.freeze({
      register: registerSidebarEntry,
      unregister: unregisterSidebarEntry,
      list: listSidebarEntries,
    }),

    settings: Object.freeze({
      register: registerSettingsPanel,
      unregister: unregisterSettingsPanel,
      list: listSettingsPanels,
    }),

    themes: Object.freeze({
      register: registerPluginTheme,
      unregister: unregisterPluginTheme,
      list: listPluginThemes,
    }),

    spotlight: Object.freeze({
      registerCommand: registerSpotlightCommand,
      unregisterCommand: unregisterSpotlightCommand,
      registerResource: registerSpotlightResource,
      unregisterResource: unregisterSpotlightResource,
    }),

    notify: Object.freeze({
      setBackend: setNotifyBackend,
      emit: emitPluginNotification,
    }),

    widgets: Object.freeze({
      register: registerWidget,
      unregister: unregisterWidget,
      list: listWidgets,
    }),

    events: Object.freeze({
      subscribe: subscribeHostEvent,
      useSubscription: useHostEventSubscription,
    }),

    apiEndpoints: Object.freeze({
      register: registerPluginEndpoint,
      unregister: unregisterPluginEndpoint,
      list: listPluginEndpoints,
    }),

    openapi: Object.freeze({
      register: registerPluginOpenApi,
      unregister: unregisterPluginOpenApi,
    }),

    permissions: Object.freeze({
      register: registerPermission,
      unregister: unregisterPermission,
      getRegistry: getPermissionRegistry,
    }),
  });
}
