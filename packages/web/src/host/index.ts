/**
 * Host-internal barrel — re-exports all 12 SDK surfaces.
 *
 * This barrel is for use WITHIN the admin (first-party code and the plugin
 * loader). The plugin-facing SDK surface lives in `src/host/sdk.ts` (Task
 * 1f.111) which re-exports the subset of this barrel that plugins are
 * permitted to use.
 *
 * 12 surfaces:
 *   1.  zones          — injection-zone registry
 *   2.  routes         — plugin-route registry
 *   3.  sidebar        — sidebar-entry registry
 *   4.  settings       — settings-panel registry
 *   5.  permissions    — permission catalog (D1)
 *   6.  themes         — plugin-theme registry
 *   7.  spotlight      — spotlight commands + resources
 *   8.  notify         — plugin notification emitter
 *   9.  widgets        — dashboard-widget registry
 *  10.  events         — host event bus
 *  11.  api-endpoints  — plugin endpoint catalog
 *  12.  openapi        — OpenAPI contribution merge
 */

// Surface 1 — zones
export * from './zones';

// Surface 2 — routes
export * from './routes';

// Surface 3 — sidebar
export * from './sidebar';

// Surface 4 — settings
export * from './settings';

// Surface 5 — permissions (D1)
export * from './permissions';

// Surface 6 — themes
export * from './themes';

// Surface 7 — spotlight
export * from './spotlight';

// Surface 8 — notify
export * from './notify';

// Surface 9 — widgets
export * from './widgets';

// Surface 10 — events
export * from './events';

// Surface 11 — api-endpoints
export * from './api-endpoints';

// Surface 12 — openapi
export * from './openapi';

// Plugin registry (not a surface — accounting layer for the loader)
export * from './plugin-registry';

// Host infrastructure
export * from './abi';
export * from './manifest-schema';
export * from './manifest-validator';
export * from './singleton-harden';
