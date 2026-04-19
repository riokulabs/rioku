import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginRegistry, listPlugins, getPlugin } from './plugin-registry';
import type { PluginManifest } from './manifest-schema';

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
