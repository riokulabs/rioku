import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePluginRegistry, listPlugins, getPlugin } from './plugin-registry';
import type { PluginManifest } from './manifest-schema';
import { loadPluginFromUrl, unloadPlugin, _setPluginImporterForTest } from './plugin-loader';
import type { RiokuHost } from '@/hooks/use-host';
import { listAllZones } from './zones';
import { listPluginRoutes } from './routes';
import { listSidebarEntries } from './sidebar';
import { listPluginThemes } from './themes';
import { listSpotlightCommands, listSpotlightResources } from './spotlight';
import { listWidgets } from './widgets';
import { listPluginEndpoints } from './api-endpoints';
import { getPermissionRegistry } from './permissions';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeManifest(name: string): PluginManifest {
  return {
    name,
    version: '1.0.0',
    displayName: `Plugin ${name}`,
    author: { name: 'Test Author' },
    abi: { minVersion: 1 },
    permissions: [],
    zones: [],
    isolation: 'shared',
  };
}

beforeEach(() => {
  usePluginRegistry.setState({ plugins: {} });
});

// ─── registerPlugin ───────────────────────────────────────────────────────────

describe('registerPlugin', () => {
  it('adds the plugin and it appears in listPlugins', () => {
    usePluginRegistry.getState().registerPlugin(makeManifest('hello-world'));
    const plugins = listPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.manifest.name).toBe('hello-world');
  });

  it('defaults enabled = true', () => {
    usePluginRegistry.getState().registerPlugin(makeManifest('my-plugin'));
    expect(getPlugin('my-plugin')?.enabled).toBe(true);
  });

  it('respects explicit enabled = false', () => {
    usePluginRegistry.getState().registerPlugin(makeManifest('my-plugin'), false);
    expect(getPlugin('my-plugin')?.enabled).toBe(false);
  });

  it('sets loadedAt to an ISO string', () => {
    usePluginRegistry.getState().registerPlugin(makeManifest('my-plugin'));
    const plugin = getPlugin('my-plugin');
    expect(plugin?.loadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('initializes empty contributions on first register', () => {
    usePluginRegistry.getState().registerPlugin(makeManifest('my-plugin'));
    const plugin = getPlugin('my-plugin');
    expect(plugin?.contributions.zones).toEqual([]);
    expect(plugin?.contributions.routes).toEqual([]);
    expect(plugin?.contributions.sidebar).toEqual([]);
    expect(plugin?.contributions.permissions).toEqual([]);
  });

  it('re-register same name updates manifest but preserves contributions', () => {
    usePluginRegistry.getState().registerPlugin(makeManifest('my-plugin'));
    usePluginRegistry.getState().trackContribution('my-plugin', 'zones', { zone: 'service.header', id: 'zone-0001' });

    const updated = makeManifest('my-plugin');
    updated.version = '2.0.0';
    usePluginRegistry.getState().registerPlugin(updated);

    const plugin = getPlugin('my-plugin');
    expect(plugin?.manifest.version).toBe('2.0.0');
    expect(plugin?.contributions.zones).toHaveLength(1);
  });
});

// ─── setPluginEnabled ─────────────────────────────────────────────────────────

describe('setPluginEnabled', () => {
  it('toggles enabled state', () => {
    usePluginRegistry.getState().registerPlugin(makeManifest('my-plugin'));
    expect(getPlugin('my-plugin')?.enabled).toBe(true);

    usePluginRegistry.getState().setPluginEnabled('my-plugin', false);
    expect(getPlugin('my-plugin')?.enabled).toBe(false);

    usePluginRegistry.getState().setPluginEnabled('my-plugin', true);
    expect(getPlugin('my-plugin')?.enabled).toBe(true);
  });

  it('no-ops for unknown plugin', () => {
    expect(() => {
      usePluginRegistry.getState().setPluginEnabled('nonexistent', false);
    }).not.toThrow();
  });
});

// ─── trackContribution ────────────────────────────────────────────────────────

describe('trackContribution', () => {
  beforeEach(() => {
    usePluginRegistry.getState().registerPlugin(makeManifest('my-plugin'));
  });

  it('appends to zones bucket', () => {
    usePluginRegistry.getState().trackContribution('my-plugin', 'zones', { zone: 'a', id: 'z1' });
    usePluginRegistry.getState().trackContribution('my-plugin', 'zones', { zone: 'b', id: 'z2' });
    const contributions = getPlugin('my-plugin')?.contributions;
    expect(contributions?.zones).toHaveLength(2);
    expect(contributions?.zones[1]).toEqual({ zone: 'b', id: 'z2' });
  });

  it('appends to routes bucket', () => {
    usePluginRegistry.getState().trackContribution('my-plugin', 'routes', { path: '/foo', id: 'r1' });
    expect(getPlugin('my-plugin')?.contributions.routes).toHaveLength(1);
  });

  it('appends to sidebar bucket', () => {
    usePluginRegistry.getState().trackContribution('my-plugin', 'sidebar', { id: 'sb1' });
    expect(getPlugin('my-plugin')?.contributions.sidebar).toHaveLength(1);
  });

  it('appends to themes bucket', () => {
    usePluginRegistry.getState().trackContribution('my-plugin', 'themes', { name: 'my-theme' });
    expect(getPlugin('my-plugin')?.contributions.themes[0]?.name).toBe('my-theme');
  });

  it('appends to permissions bucket', () => {
    usePluginRegistry.getState().trackContribution('my-plugin', 'permissions', 'com.acme.foo:read');
    expect(getPlugin('my-plugin')?.contributions.permissions).toContain('com.acme.foo:read');
  });

  it('no-ops for unknown plugin', () => {
    expect(() => {
      usePluginRegistry.getState().trackContribution('ghost', 'zones', { zone: 'x', id: 'y' });
    }).not.toThrow();
  });
});

// ─── unregisterPlugin ─────────────────────────────────────────────────────────

describe('unregisterPlugin', () => {
  it('removes the plugin from the map', () => {
    usePluginRegistry.getState().registerPlugin(makeManifest('my-plugin'));
    expect(listPlugins()).toHaveLength(1);

    usePluginRegistry.getState().unregisterPlugin('my-plugin');
    expect(listPlugins()).toHaveLength(0);
    expect(getPlugin('my-plugin')).toBeUndefined();
  });

  it('no-ops silently for unknown plugin', () => {
    expect(() => {
      usePluginRegistry.getState().unregisterPlugin('ghost');
    }).not.toThrow();
  });
});

// ─── listPlugins ─────────────────────────────────────────────────────────────

describe('listPlugins', () => {
  it('returns plugins sorted by name', () => {
    usePluginRegistry.getState().registerPlugin(makeManifest('zebra'));
    usePluginRegistry.getState().registerPlugin(makeManifest('alpha'));
    usePluginRegistry.getState().registerPlugin(makeManifest('mango'));

    const names = listPlugins().map((p) => p.manifest.name);
    expect(names).toEqual(['alpha', 'mango', 'zebra']);
  });

  it('returns empty array when no plugins are registered', () => {
    expect(listPlugins()).toEqual([]);
  });
});

// ─── Register/unregister roundtrip through the plugin-loader ─────────────────
//
// These tests exercise the full loader path so tracked-contribution bookkeeping
// (the real reason the plugin registry exists) is verified — not just the
// naked Zustand store operations above.

describe('plugin-registry ↔ plugin-loader roundtrip', () => {
  function stubManifestFetch(manifest: Record<string, unknown>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve(JSON.stringify(manifest)),
      }),
    );
  }

  function setMockPlugin(defaultExport: (host: RiokuHost) => void | Promise<void>): void {
    _setPluginImporterForTest((_url: string) =>
      Promise.resolve({ default: defaultExport }),
    );
  }

  const manifest = {
    name: 'roundtrip-plugin',
    version: '1.0.0',
    displayName: 'Roundtrip Plugin',
    author: { name: 'Test' },
    abi: { minVersion: 1 },
    parts: { admin: 'http://localhost/roundtrip/admin.mjs' },
    permissions: [],
    zones: [],
    isolation: 'shared',
  };

  beforeEach(() => {
    usePluginRegistry.setState({ plugins: {} });
    vi.clearAllMocks();
    _setPluginImporterForTest(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _setPluginImporterForTest(undefined);
  });

  it('tracks contributions across every surface a plugin touches', async () => {
    setMockPlugin((host) => {
      host.zones.register({
        zone: 'dashboard.header',
        component: (() => null) as unknown as React.ComponentType,
        source: 'plugin',
        pluginName: 'roundtrip-plugin',
      });
      host.routes.register({
        path: '/plugins/roundtrip/page',
        component: (() => null) as unknown as React.ComponentType,
        source: 'plugin',
        pluginName: 'roundtrip-plugin',
      });
      host.sidebar.register({
        group: 'plugins',
        label: 'Roundtrip',
        path: '/plugins/roundtrip/page',
        source: 'plugin',
        pluginName: 'roundtrip-plugin',
      });
      host.themes.register({
        name: 'roundtrip-theme',
        displayName: 'Roundtrip Theme',
        colorScheme: 'dark',
        theme: {},
        source: 'plugin',
      });
      host.widgets.register({
        type: 'com.roundtrip:widget',
        displayName: 'Roundtrip Widget',
        schema: { input: {}, config: {} },
        component: (() => null) as unknown as React.ComponentType<{ data: unknown; config: unknown }>,
        source: 'plugin',
        pluginName: 'roundtrip-plugin',
      });
      host.spotlight.registerCommand({
        id: 'roundtrip-cmd',
        label: 'Run roundtrip',
        source: 'plugin',
        pluginName: 'roundtrip-plugin',
        onAction: () => void 0,
      });
      host.apiEndpoints.register({
        method: 'GET',
        path: '/roundtrip/status',
        description: 'status',
        source: 'plugin',
        pluginName: 'roundtrip-plugin',
      });
      host.permissions.register({
        key: 'com.roundtrip:act',
        description: 'act',
        source: 'plugin-manifest',
      });
    });

    stubManifestFetch(manifest);
    const result = await loadPluginFromUrl('http://localhost/roundtrip/manifest.json');
    expect(result.ok).toBe(true);

    const plugin = getPlugin('roundtrip-plugin');
    expect(plugin).toBeDefined();
    expect(plugin?.contributions.zones).toHaveLength(1);
    expect(plugin?.contributions.routes).toHaveLength(1);
    expect(plugin?.contributions.sidebar).toHaveLength(1);
    expect(plugin?.contributions.themes).toHaveLength(1);
    expect(plugin?.contributions.widgets).toHaveLength(1);
    expect(plugin?.contributions.spotlight).toHaveLength(1);
    expect(plugin?.contributions.apiEndpoints).toHaveLength(1);
    expect(plugin?.contributions.permissions).toContain('com.roundtrip:act');
  });

  it('clears every surface registry on unload', async () => {
    setMockPlugin((host) => {
      host.zones.register({
        zone: 'unload.zone',
        component: (() => null) as unknown as React.ComponentType,
        source: 'plugin',
        pluginName: 'roundtrip-plugin',
      });
      host.routes.register({
        path: '/plugins/roundtrip/bye',
        component: (() => null) as unknown as React.ComponentType,
        source: 'plugin',
        pluginName: 'roundtrip-plugin',
      });
      host.sidebar.register({
        group: 'plugins',
        label: 'Bye',
        path: '/plugins/roundtrip/bye',
        source: 'plugin',
        pluginName: 'roundtrip-plugin',
      });
      host.themes.register({
        name: 'roundtrip-bye-theme',
        displayName: 'Bye',
        colorScheme: 'dark',
        theme: {},
        source: 'plugin',
      });
      host.widgets.register({
        type: 'com.roundtrip:bye-widget',
        displayName: 'Bye Widget',
        schema: { input: {}, config: {} },
        component: (() => null) as unknown as React.ComponentType<{ data: unknown; config: unknown }>,
        source: 'plugin',
      });
      host.spotlight.registerCommand({
        id: 'roundtrip-bye-cmd',
        label: 'Bye',
        source: 'plugin',
        pluginName: 'roundtrip-plugin',
        onAction: () => void 0,
      });
      host.spotlight.registerResource({
        type: 'com.roundtrip:search',
        search: () => Promise.resolve([]),
        source: 'plugin',
        pluginName: 'roundtrip-plugin',
      });
      host.apiEndpoints.register({
        method: 'POST',
        path: '/roundtrip/action',
        source: 'plugin',
        pluginName: 'roundtrip-plugin',
      });
      host.permissions.register({
        key: 'com.roundtrip:bye',
        description: 'bye',
        source: 'plugin-manifest',
      });
    });

    stubManifestFetch(manifest);
    await loadPluginFromUrl('http://localhost/roundtrip/manifest.json');

    // Sanity check — everything registered before unload.
    expect(listAllZones()).toContain('unload.zone');
    expect(listPluginRoutes().some((r) => r.path === '/plugins/roundtrip/bye')).toBe(true);
    expect(listSidebarEntries('plugins').some((s) => s.path === '/plugins/roundtrip/bye')).toBe(true);
    expect(listPluginThemes().some((t) => t.name === 'roundtrip-bye-theme')).toBe(true);
    expect(listWidgets().some((w) => w.type === 'com.roundtrip:bye-widget')).toBe(true);
    expect(listSpotlightCommands().some((c) => c.id === 'roundtrip-bye-cmd')).toBe(true);
    expect(
      listSpotlightResources().some((r) => r.type === 'com.roundtrip:search'),
    ).toBe(true);
    expect(
      listPluginEndpoints().some((e) => e.path === '/roundtrip/action'),
    ).toBe(true);
    expect(getPermissionRegistry().has('com.roundtrip:bye')).toBe(true);

    await unloadPlugin('roundtrip-plugin');

    expect(listAllZones()).not.toContain('unload.zone');
    expect(listPluginRoutes().some((r) => r.path === '/plugins/roundtrip/bye')).toBe(false);
    expect(listSidebarEntries('plugins').some((s) => s.path === '/plugins/roundtrip/bye')).toBe(false);
    expect(listPluginThemes().some((t) => t.name === 'roundtrip-bye-theme')).toBe(false);
    expect(listWidgets().some((w) => w.type === 'com.roundtrip:bye-widget')).toBe(false);
    expect(listSpotlightCommands().some((c) => c.id === 'roundtrip-bye-cmd')).toBe(false);
    expect(
      listSpotlightResources().some((r) => r.type === 'com.roundtrip:search'),
    ).toBe(false);
    expect(
      listPluginEndpoints().some((e) => e.path === '/roundtrip/action'),
    ).toBe(false);
    expect(getPermissionRegistry().has('com.roundtrip:bye')).toBe(false);
    expect(getPlugin('roundtrip-plugin')).toBeUndefined();
  });

  it('allows two plugins with disjoint contributions to coexist', async () => {
    setMockPlugin((host) => {
      host.sidebar.register({
        group: 'plugins',
        label: 'Plugin A',
        path: '/plugins/a',
        source: 'plugin',
        pluginName: 'plugin-a',
      });
    });
    stubManifestFetch({ ...manifest, name: 'plugin-a' });
    await loadPluginFromUrl('http://localhost/plugin-a/manifest.json');

    setMockPlugin((host) => {
      host.sidebar.register({
        group: 'plugins',
        label: 'Plugin B',
        path: '/plugins/b',
        source: 'plugin',
        pluginName: 'plugin-b',
      });
    });
    stubManifestFetch({ ...manifest, name: 'plugin-b' });
    await loadPluginFromUrl('http://localhost/plugin-b/manifest.json');

    const paths = listSidebarEntries('plugins').map((s) => s.path);
    expect(paths).toContain('/plugins/a');
    expect(paths).toContain('/plugins/b');
    expect(listPlugins().map((p) => p.manifest.name)).toEqual(
      expect.arrayContaining(['plugin-a', 'plugin-b']),
    );
  });

  it('collides when a second plugin contributes an already-registered sidebar path', async () => {
    setMockPlugin((host) => {
      host.sidebar.register({
        group: 'plugins',
        label: 'First',
        path: '/plugins/shared',
        source: 'plugin',
        pluginName: 'plugin-first',
      });
    });
    stubManifestFetch({ ...manifest, name: 'plugin-first' });
    await loadPluginFromUrl('http://localhost/first/manifest.json');

    setMockPlugin((host) => {
      // Same path as the first plugin — sidebar rejects duplicates and returns
      // the existing id, so the colliding plugin does NOT get its own entry.
      host.sidebar.register({
        group: 'plugins',
        label: 'Second (colliding)',
        path: '/plugins/shared',
        source: 'plugin',
        pluginName: 'plugin-second',
      });
    });
    stubManifestFetch({ ...manifest, name: 'plugin-second' });
    await loadPluginFromUrl('http://localhost/second/manifest.json');

    const shared = listSidebarEntries('plugins').filter((s) => s.path === '/plugins/shared');
    expect(shared).toHaveLength(1);
    expect(shared[0]?.pluginName).toBe('plugin-first');
  });
});

// ─── Re-registering the same plugin id (idempotent update) ───────────────────

describe('re-register same plugin id', () => {
  it('preserves contributions across idempotent re-registration', () => {
    usePluginRegistry.getState().registerPlugin(makeManifest('rere'));
    usePluginRegistry
      .getState()
      .trackContribution('rere', 'zones', { zone: 'foo', id: 'z1' });

    // Second call with same name and updated manifest version
    const updated = makeManifest('rere');
    updated.version = '2.0.0';
    usePluginRegistry.getState().registerPlugin(updated, false);

    const p = getPlugin('rere');
    // Updated manifest applied, but enabled/contributions preserved.
    expect(p?.manifest.version).toBe('2.0.0');
    expect(p?.contributions.zones).toHaveLength(1);
    // `enabled` parameter is ignored on re-register — previous state wins.
    expect(p?.enabled).toBe(true);
  });
});
