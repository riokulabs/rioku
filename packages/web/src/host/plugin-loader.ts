/**
 * Plugin loader — resolves manifest, validates ABI, loads admin ESM bundle,
 * invokes the plugin's default export with a host object, tracks registered
 * contributions, and cleans up on unload.
 *
 * Stage-1 scope:
 *   - loadPluginFromUrl(manifestUrl)   — fetch + parse + load
 *   - loadDevPluginSideload(...)       — dev-only; skips manifest fetch
 *   - loadSandboxedPlugin(manifestUrl) — iframe-mode stub (real RPC later)
 *   - unloadPlugin(name)               — call the plugin's contribution unregister fns
 *
 * Limitations (stage-1):
 *   - YAML manifests are NOT supported — only JSON. A future stage can add the
 *     `yaml` package and detect the content-type or file extension.
 *   - `isolation: 'sandbox'` iframe mode is a STUB.  The iframe is created and
 *     a postMessage handshake is logged, but no actual plugin code is executed
 *     inside the frame.  Real sandboxed RPC lands in a later stage.
 *
 * spec §9.2, §9.4, §9.10.1 B1/B4
 */

import { validateManifest } from './manifest-validator';
import { checkAbiCompatibility } from './abi';
import { getHostInstance } from './host-singleton';
import { usePluginRegistry } from './plugin-registry';
import type { PluginContributions } from './plugin-registry';
import { emitHostEvent } from './events';
import type { PluginManifest } from './manifest-schema';

// Surface unregister fns — needed for unload
import { unregisterZone } from './zones';
import { unregisterRoute } from './routes';
import { unregisterSidebarEntry } from './sidebar';
import { unregisterSettingsPanel } from './settings';
import { unregisterPluginTheme } from './themes';
import { unregisterSpotlightCommand, unregisterSpotlightResource } from './spotlight';
import { unregisterWidget } from './widgets';
import { listPluginEndpoints, unregisterPluginEndpoint } from './api-endpoints';
import { unregisterPluginOpenApi } from './openapi';
import { unregisterPermission } from './permissions';

// ─── Result type ──────────────────────────────────────────────────────────────

export interface LoadResult {
  ok: boolean;
  manifest?: PluginManifest;
  errors?: string[];
  warnings?: string[];
}

// ─── Sandbox DOM helpers ──────────────────────────────────────────────────────

const SANDBOX_CONTAINER_ID = 'rioku-plugin-sandbox-container';

function getSandboxContainer(): HTMLDivElement {
  let el = document.getElementById(SANDBOX_CONTAINER_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = SANDBOX_CONTAINER_ID;
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  return el;
}

// ─── loadPluginFromUrl ────────────────────────────────────────────────────────

/**
 * Fetch a JSON manifest from `manifestUrl`, validate it, load the admin
 * ESM bundle, invoke the plugin's default export with the host, and register
 * contributions.
 *
 * Stage-1 only supports JSON manifests.  YAML manifests will fail the
 * `JSON.parse` step and return an error.
 */
export async function loadPluginFromUrl(
  manifestUrl: string,
  options?: { enabled?: boolean },
): Promise<LoadResult> {
  // ── Step 1: Fetch manifest ─────────────────────────────────────────────────
  let raw: unknown;
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      return {
        ok: false,
        errors: [`manifest fetch failed: ${String(res.status)} ${res.statusText}`],
      };
    }
    // Stage-1: JSON only. YAML manifests will throw here.
    const text = await res.text();
    raw = JSON.parse(text) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`manifest fetch/parse error: ${msg}`] };
  }

  // ── Step 2: Validate manifest ──────────────────────────────────────────────
  const validationResult = validateManifest(raw);
  if (!validationResult.ok) {
    return {
      ok: false,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
    };
  }

  const { manifest, warnings } = validationResult;

  // ── Step 3: ABI compatibility ──────────────────────────────────────────────
  const abiCheck = checkAbiCompatibility(manifest.abi.minVersion, manifest.abi.maxVersion);
  if (!abiCheck.compatible) {
    return {
      ok: false,
      errors: [`ABI incompatible: ${abiCheck.reason ?? 'unknown'}`],
      warnings,
    };
  }

  // ── Step 4: Isolation mode ─────────────────────────────────────────────────
  if (manifest.isolation === 'sandbox') {
    console.warn(
      `[plugin-loader] Plugin "${manifest.name}" requests isolation: 'sandbox' — ` +
        'sandbox (iframe) mode is not fully implemented in stage-1. ' +
        'Falling through to shared-context load. This will change in a later stage.',
    );
  }

  // ── Step 5: Load admin bundle ──────────────────────────────────────────────
  if (!manifest.parts?.admin) {
    // No admin bundle — register as metadata-only plugin.
    usePluginRegistry.getState().registerPlugin(manifest, options?.enabled ?? true);
    emitHostEvent('plugin:installed', { name: manifest.name, version: manifest.version });
    return { ok: true, manifest, warnings };
  }

  const adminBundleUrl = new URL(manifest.parts.admin, manifestUrl).href;
  return _loadAdminBundle(manifest, adminBundleUrl, warnings, options?.enabled ?? true);
}

// ─── loadDevPluginSideload ────────────────────────────────────────────────────

/**
 * Dev-only plugin sideload.  Skips the manifest fetch step — the caller
 * provides a pre-constructed (potentially synthetic) manifest and the path to
 * the compiled ESM bundle.
 *
 * Guard: this function logs a warning in production but still runs.
 * The actual guard is in the call site (app.tsx / dev-sideload.tsx) which
 * gates on `import.meta.env.DEV`.
 */
export async function loadDevPluginSideload(
  slug: string,
  pluginMjsPath: string,
  manifest: PluginManifest,
): Promise<LoadResult> {
  const warnings: string[] = [];

  if (!import.meta.env.DEV) {
    console.warn(`[plugin-loader] loadDevPluginSideload("${slug}") called in production build`);
  }

  // ABI check on the supplied manifest
  const abiCheck = checkAbiCompatibility(manifest.abi.minVersion, manifest.abi.maxVersion);
  if (!abiCheck.compatible) {
    return {
      ok: false,
      errors: [`ABI incompatible: ${abiCheck.reason ?? 'unknown'}`],
      warnings,
    };
  }

  console.info(`[dev-sideload] loading "${slug}" from ${pluginMjsPath}`);
  return _loadAdminBundle(manifest, pluginMjsPath, warnings, true);
}

// ─── loadSandboxedPlugin ──────────────────────────────────────────────────────

/**
 * Iframe-mode plugin sandbox stub — spec §9.4 (sandbox path).
 *
 * Stage-1: Creates the iframe with the correct security attributes and wires a
 * minimal postMessage handshake that logs only.  Real sandboxed RPC (structured
 * clone, capability negotiation) lands in a later stage.
 *
 * The plugin is registered in `pluginRegistry` with `isolation: 'sandbox'` so
 * the UI can display its status.  No contributions are tracked because the
 * plugin code runs inside the iframe and cannot call host registries directly
 * in stage-1.
 */
export async function loadSandboxedPlugin(manifestUrl: string): Promise<LoadResult> {
  // ── Fetch + validate manifest ──────────────────────────────────────────────
  let raw: unknown;
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      return {
        ok: false,
        errors: [`manifest fetch failed: ${String(res.status)} ${res.statusText}`],
      };
    }
    raw = JSON.parse(await res.text()) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`manifest fetch/parse error: ${msg}`] };
  }

  const validationResult = validateManifest(raw);
  if (!validationResult.ok) {
    return {
      ok: false,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
    };
  }

  const { manifest, warnings } = validationResult;

  const abiCheck = checkAbiCompatibility(manifest.abi.minVersion, manifest.abi.maxVersion);
  if (!abiCheck.compatible) {
    return {
      ok: false,
      errors: [`ABI incompatible: ${abiCheck.reason ?? 'unknown'}`],
      warnings,
    };
  }

  if (!manifest.parts?.admin) {
    return { ok: false, errors: ['sandbox plugin has no admin bundle'], warnings };
  }

  // ── Create iframe ──────────────────────────────────────────────────────────
  const adminBundleUrl = new URL(manifest.parts.admin, manifestUrl).href;
  const container = getSandboxContainer();

  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts'); // NOT allow-same-origin
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('allow', '');
  iframe.src = adminBundleUrl;
  iframe.title = manifest.displayName;
  iframe.dataset.pluginName = manifest.name;
  container.appendChild(iframe);

  // ── Stub postMessage RPC ──────────────────────────────────────────────────
  // Stage-1: log the handshake; real capability-exchange lands later.
  const channel = new MessageChannel();
  channel.port1.onmessage = (e) => {
    console.info(
      `[plugin-sandbox] message from "${manifest.name}":`,
      e.data,
    );
  };
  // Transfer port2 to the iframe once it loads
  iframe.addEventListener(
    'load',
    () => {
      iframe.contentWindow?.postMessage(
        { type: 'rioku:sandbox:init', pluginName: manifest.name },
        '*',
        [channel.port2],
      );
      console.info(`[plugin-sandbox] handshake sent to "${manifest.name}" (stage-1 stub)`);
    },
    { once: true },
  );

  // Register in plugin registry
  usePluginRegistry.getState().registerPlugin(manifest, true);
  emitHostEvent('plugin:installed', { name: manifest.name, version: manifest.version });

  return { ok: true, manifest, warnings };
}

// ─── unloadPlugin ─────────────────────────────────────────────────────────────

/**
 * Unload a plugin by name.
 *
 * Calls the appropriate surface unregister function for each tracked
 * contribution, then removes the plugin from the registry and emits
 * `plugin:uninstalled`.
 *
 * No-op if the plugin is not currently registered.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- kept async for API consistency; callers await it
export async function unloadPlugin(name: string): Promise<void> {
  const plugin = usePluginRegistry.getState().getPlugin(name);
  if (!plugin) {
    if (import.meta.env.DEV) {
      console.warn(`[plugin-loader] unloadPlugin("${name}"): plugin not found`);
    }
    return;
  }

  const { contributions } = plugin;

  // Surface 1 — zones
  for (const contrib of contributions.zones) {
    unregisterZone(contrib.id);
  }

  // Surface 2 — routes
  for (const contrib of contributions.routes) {
    unregisterRoute(contrib.id);
  }

  // Surface 3 — sidebar
  for (const contrib of contributions.sidebar) {
    unregisterSidebarEntry(contrib.id);
  }

  // Surface 4 — settings
  for (const contrib of contributions.settings) {
    unregisterSettingsPanel(contrib.id);
  }

  // Surface 6 — themes
  for (const contrib of contributions.themes) {
    unregisterPluginTheme(contrib.name);
  }

  // Surface 7 — spotlight
  for (const contrib of contributions.spotlight) {
    // spotlight contributions are stored as { id } — could be command or resource.
    // We attempt both; each is a no-op if not found.
    unregisterSpotlightCommand(contrib.id);
    unregisterSpotlightResource(contrib.id);
  }

  // Surface 9 — widgets
  for (const contrib of contributions.widgets) {
    unregisterWidget(contrib.type);
  }

  // Surface 11 — api-endpoints
  // PluginContributions.apiEndpoints only stores { path } — look up method
  // from the live endpoint store so we can call unregisterPluginEndpoint(method, path).
  const liveEndpoints = listPluginEndpoints(name);
  for (const ep of liveEndpoints) {
    unregisterPluginEndpoint(ep.method, ep.path);
  }

  // Surface 12 — openapi
  // openapi contributions don't have a simple id in PluginContributions —
  // we track by pluginName in the openapi registry itself.
  unregisterPluginOpenApi(name);

  // Surface 5 — permissions
  for (const key of contributions.permissions) {
    unregisterPermission(key);
  }

  // Remove iframe (if sandbox mode)
  const container = document.getElementById(SANDBOX_CONTAINER_ID);
  if (container) {
    const iframe = container.querySelector<HTMLIFrameElement>(
      `iframe[data-plugin-name="${CSS.escape(name)}"]`,
    );
    iframe?.remove();
  }

  // Remove from registry
  usePluginRegistry.getState().unregisterPlugin(name);
  emitHostEvent('plugin:uninstalled', { name });
}

// ─── Injectable import function (for testing) ─────────────────────────────────

/**
 * The dynamic import function used by the loader.
 *
 * In production/dev: calls `import(url)` directly.
 * In tests: can be replaced via `setPluginImporter()` to inject a mock module.
 *
 * This indirection exists because Vitest/jsdom cannot resolve dynamic ESM
 * imports from Blob URLs in the test environment.
 */
type PluginImporter = (url: string) => Promise<Record<string, unknown>>;

let _pluginImporter: PluginImporter = (url) =>
  // @vite-ignore prevents Vite from analyzing this at build time.
  import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>;

/**
 * Override the dynamic importer — FOR TESTING ONLY.
 * Restore to default by calling with `undefined`.
 */
export function _setPluginImporterForTest(fn: PluginImporter | undefined): void {
  _pluginImporter = fn ?? ((url) => import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>);
}

// ─── Tracked host wrapper ─────────────────────────────────────────────────────

/**
 * Build a `RiokuHost` wrapper that intercepts registration calls and records
 * each contribution in the plugin registry so they can be cleaned up on unload.
 *
 * This is NOT a deep proxy — only the `register` methods on each surface are
 * wrapped.  Read-only methods (list, get, subscribe) pass through unchanged.
 */
function _buildTrackedHost(pluginName: string): ReturnType<typeof getHostInstance> {
  const base = getHostInstance();
  // Arrow wrapper to avoid `this` scoping concerns when the method is
  // extracted from the Zustand store object.
  function track<K extends keyof PluginContributions>(
    name: string,
    kind: K,
    entry: PluginContributions[K][number],
  ): void {
    usePluginRegistry.getState().trackContribution(name, kind, entry);
  }

  const zones = Object.freeze({
    ...base.zones,
    register: (contrib: Parameters<typeof base.zones.register>[0]) => {
      const id = base.zones.register(contrib);
      track(pluginName, 'zones', { zone: contrib.zone, id });
      return id;
    },
  });

  const routes = Object.freeze({
    ...base.routes,
    register: (contrib: Parameters<typeof base.routes.register>[0]) => {
      const id = base.routes.register(contrib);
      track(pluginName, 'routes', { path: contrib.path, id });
      return id;
    },
  });

  const sidebar = Object.freeze({
    ...base.sidebar,
    register: (entry: Parameters<typeof base.sidebar.register>[0]) => {
      const id = base.sidebar.register(entry);
      track(pluginName, 'sidebar', { id });
      return id;
    },
  });

  const settings = Object.freeze({
    ...base.settings,
    register: (panel: Parameters<typeof base.settings.register>[0]) => {
      const id = base.settings.register(panel);
      track(pluginName, 'settings', { id });
      return id;
    },
  });

  const themes = Object.freeze({
    ...base.themes,
    register: (theme: Parameters<typeof base.themes.register>[0]) => {
      const name = base.themes.register(theme);
      track(pluginName, 'themes', { name });
      return name;
    },
  });

  const spotlight = Object.freeze({
    ...base.spotlight,
    registerCommand: (cmd: Parameters<typeof base.spotlight.registerCommand>[0]) => {
      const id = base.spotlight.registerCommand(cmd);
      track(pluginName, 'spotlight', { id });
      return id;
    },
    registerResource: (resource: Parameters<typeof base.spotlight.registerResource>[0]) => {
      base.spotlight.registerResource(resource);
      track(pluginName, 'spotlight', { id: resource.type });
    },
  });

  const widgets = Object.freeze({
    ...base.widgets,
    register: (widget: Parameters<typeof base.widgets.register>[0]) => {
      base.widgets.register(widget);
      track(pluginName, 'widgets', { type: widget.type });
    },
  });

  const apiEndpoints = Object.freeze({
    ...base.apiEndpoints,
    register: (endpoint: Parameters<typeof base.apiEndpoints.register>[0]) => {
      base.apiEndpoints.register(endpoint);
      track(pluginName, 'apiEndpoints', { path: endpoint.path });
    },
  });

  const permissions = Object.freeze({
    ...base.permissions,
    register: (permission: Parameters<typeof base.permissions.register>[0]) => {
      base.permissions.register(permission);
      track(pluginName, 'permissions', permission.key);
    },
  });

  // openapi — track by pluginName (the registry handles that internally)
  const openapi = Object.freeze({ ...base.openapi });

  return Object.freeze({
    ...base,
    zones,
    routes,
    sidebar,
    settings,
    themes,
    spotlight,
    widgets,
    apiEndpoints,
    permissions,
    openapi,
  });
}

// ─── Internal: load admin ESM bundle ─────────────────────────────────────────

async function _loadAdminBundle(
  manifest: PluginManifest,
  adminBundleUrl: string,
  warnings: string[],
  enabled: boolean,
): Promise<LoadResult> {
  let mod: Record<string, unknown>;
  try {
    mod = await _pluginImporter(adminBundleUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [`failed to load admin bundle from "${adminBundleUrl}": ${msg}`],
      warnings,
    };
  }

  const register = mod.default;
  if (typeof register !== 'function') {
    return {
      ok: false,
      errors: [
        `plugin "${manifest.name}" has no default export (expected a function, got ${typeof register})`,
      ],
      warnings,
    };
  }

  // Register the plugin BEFORE invoking `register()` so that the tracking
  // wrappers below can call `trackContribution`.
  usePluginRegistry.getState().registerPlugin(manifest, enabled);

  // Build a tracked host wrapper: wraps each surface registry's `register`
  // call so contributions are recorded in pluginRegistry for later unload.
  const host = _buildTrackedHost(manifest.name);

  try {
    // The plugin's default export receives the frozen host and may do anything
    // synchronous or asynchronous to register its contributions.
    // Cast: `register` is `unknown` after the typeof check — narrow to callable.
    await (register as (h: typeof host) => Promise<void> | void)(host);
  } catch (err) {
    // Plugin threw during registration — undo everything.
    await unloadPlugin(manifest.name);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [`plugin "${manifest.name}" threw during register(): ${msg}`],
      warnings,
    };
  }

  emitHostEvent('plugin:installed', { name: manifest.name, version: manifest.version });

  if (import.meta.env.DEV) {
    console.info(`[plugin-loader] loaded "${manifest.name}" v${manifest.version}`);
  }

  return { ok: true, manifest, warnings };
}
