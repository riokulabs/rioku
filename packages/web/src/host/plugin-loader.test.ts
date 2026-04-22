/**
 * plugin-loader.test.ts — Unit tests for Task 1f.113 / 1f.115.
 *
 * Tests:
 *   1. Load a plugin → registers zone + sidebar entry
 *   2. Unload that plugin → zone + sidebar removed from registries
 *   3. Plugin with wrong ABI → load fails with clear error
 *   4. Plugin with bad manifest → validation errors returned
 *   5. Plugin that throws in register → load fails, contributions cleaned up
 *   6. Fetch failure → error result
 *   7. Iframe stub (loadSandboxedPlugin) — iframe created with correct attrs
 *   8. unloadPlugin removes sandbox iframe from DOM
 *
 * Vitest + jsdom environment.
 *
 * The dynamic import is intercepted via `_setPluginImporterForTest()` — an
 * escape hatch that lets tests inject a mock module without needing real
 * Blob URL dynamic imports (which jsdom cannot resolve).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadPluginFromUrl,
  loadSandboxedPlugin,
  unloadPlugin,
  _setPluginImporterForTest,
} from './plugin-loader';
import { usePluginRegistry } from './plugin-registry';
import { getZoneContributions } from './zones';
import { listSidebarEntries } from './sidebar';
import type { RiokuHost } from '@/hooks/use-host';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stubFetch(body: string, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: () => Promise.resolve(body),
    }),
  );
}

function makeManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'test-plugin',
    version: '1.0.0',
    displayName: 'Test Plugin',
    author: { name: 'Tester' },
    abi: { minVersion: 1 },
    parts: { admin: 'http://localhost/plugin/admin.mjs' },
    permissions: [],
    zones: [],
    isolation: 'shared',
    ...overrides,
  });
}

/** Inject a mock ESM default export as the plugin module. */
function setMockPlugin(defaultExport: (host: RiokuHost) => void | Promise<void>) {
  _setPluginImporterForTest((_url: string) => Promise.resolve({ default: defaultExport }));
}

function resetRegistry() {
  usePluginRegistry.setState({ plugins: {} });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('plugin-loader', () => {
  beforeEach(() => {
    resetRegistry();
    vi.clearAllMocks();
    _setPluginImporterForTest(undefined); // restore default (won't be called unless fetch succeeds)
    const container = document.getElementById('rioku-plugin-sandbox-container');
    if (container) container.remove();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _setPluginImporterForTest(undefined);
  });

  // ── Test 1: successful load ──────────────────────────────────────────────────

  it('loads a plugin and registers its zone + sidebar entry', async () => {
    setMockPlugin((host) => {
      host.zones.register({
        zone: 'dashboard.header',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        component: (() => null) as any,
        source: 'plugin',
        pluginName: 'test-plugin',
      });
      host.sidebar.register({
        group: 'plugins',
        label: 'Test Plugin',
        path: '/plugins/test-plugin',
        source: 'plugin',
        pluginName: 'test-plugin',
      });
    });

    stubFetch(makeManifest({ name: 'test-plugin' }));

    const result = await loadPluginFromUrl('http://localhost/test-plugin/manifest.json');

    expect(result.ok).toBe(true);
    expect(result.manifest?.name).toBe('test-plugin');

    const plugin = usePluginRegistry.getState().getPlugin('test-plugin');
    expect(plugin).toBeDefined();
    expect(plugin?.enabled).toBe(true);

    expect(getZoneContributions('dashboard.header')).toHaveLength(1);
    expect(listSidebarEntries('plugins').some((e) => e.pluginName === 'test-plugin')).toBe(true);
  });

  // ── Test 2: unload removes contributions ─────────────────────────────────────

  it('unloads a plugin and removes zone + sidebar contributions', async () => {
    setMockPlugin((host) => {
      host.zones.register({
        zone: 'unload.zone',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        component: (() => null) as any,
        source: 'plugin',
        pluginName: 'unload-test',
      });
      host.sidebar.register({
        group: 'plugins',
        label: 'Unload Test',
        path: '/plugins/unload-test',
        source: 'plugin',
        pluginName: 'unload-test',
      });
    });

    stubFetch(makeManifest({ name: 'unload-test' }));
    await loadPluginFromUrl('http://localhost/unload-test/manifest.json');

    expect(getZoneContributions('unload.zone')).toHaveLength(1);
    expect(listSidebarEntries('plugins').some((e) => e.path === '/plugins/unload-test')).toBe(true);

    await unloadPlugin('unload-test');

    expect(getZoneContributions('unload.zone')).toHaveLength(0);
    expect(listSidebarEntries('plugins').some((e) => e.path === '/plugins/unload-test')).toBe(
      false,
    );
    expect(usePluginRegistry.getState().getPlugin('unload-test')).toBeUndefined();
  });

  // ── Test 3: wrong ABI ─────────────────────────────────────────────────────────

  it('returns an ABI error when plugin requires a higher ABI version', async () => {
    stubFetch(makeManifest({ abi: { minVersion: 9999 } }));

    const result = await loadPluginFromUrl('http://localhost/future-plugin/manifest.json');

    expect(result.ok).toBe(false);
    expect(result.errors?.some((e) => e.includes('ABI incompatible'))).toBe(true);
  });

  // ── Test 4: bad manifest ──────────────────────────────────────────────────────

  it('returns validation errors for a malformed manifest', async () => {
    stubFetch(JSON.stringify({ name: 'BAD NAME WITH SPACES', version: 'not-semver' }));

    const result = await loadPluginFromUrl('http://localhost/bad-plugin/manifest.json');

    expect(result.ok).toBe(false);
    expect((result.errors ?? []).length).toBeGreaterThan(0);
  });

  // ── Test 5: plugin throws in register ────────────────────────────────────────

  it('fails and cleans up contributions when plugin throws during register()', async () => {
    setMockPlugin((host) => {
      host.zones.register({
        zone: 'throw.zone',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        component: (() => null) as any,
        source: 'plugin',
        pluginName: 'throwing-plugin',
      });
      throw new Error('intentional registration failure');
    });

    stubFetch(makeManifest({ name: 'throwing-plugin' }));

    const result = await loadPluginFromUrl('http://localhost/throwing-plugin/manifest.json');

    expect(result.ok).toBe(false);
    expect(result.errors?.some((e) => e.includes('intentional registration failure'))).toBe(true);

    // Plugin should not be in registry after cleanup
    expect(usePluginRegistry.getState().getPlugin('throwing-plugin')).toBeUndefined();
    // Zone contribution should have been cleaned up
    expect(getZoneContributions('throw.zone')).toHaveLength(0);
  });

  // ── Test 6: fetch failure ─────────────────────────────────────────────────────

  it('returns an error when manifest fetch fails with 404', async () => {
    stubFetch('', 404);

    const result = await loadPluginFromUrl('http://localhost/missing/manifest.json');

    expect(result.ok).toBe(false);
    expect(result.errors?.some((e) => e.includes('404'))).toBe(true);
  });

  // ── Test 7: loadSandboxedPlugin creates iframe with correct attrs ─────────────

  it('loadSandboxedPlugin creates an iframe with required security attributes', async () => {
    stubFetch(
      makeManifest({
        name: 'sandbox-plugin',
        displayName: 'Sandbox Plugin',
        isolation: 'sandbox',
        parts: { admin: 'http://localhost/sandbox-plugin/admin.mjs' },
      }),
    );

    const result = await loadSandboxedPlugin('http://localhost/sandbox-plugin/manifest.json');

    expect(result.ok).toBe(true);

    const container = document.getElementById('rioku-plugin-sandbox-container');
    expect(container).not.toBeNull();

    const iframe = container?.querySelector<HTMLIFrameElement>(
      'iframe[data-plugin-name="sandbox-plugin"]',
    );
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(iframe?.getAttribute('loading')).toBe('lazy');
    expect(iframe?.getAttribute('allow')).toBe('');
    expect(iframe?.title).toBe('Sandbox Plugin');
  });

  // ── Test 8: unloadPlugin removes sandbox iframe ───────────────────────────────

  it('unloadPlugin removes the sandbox iframe from DOM', async () => {
    stubFetch(
      makeManifest({
        name: 'sandbox-unload',
        displayName: 'Sandbox Unload',
        isolation: 'sandbox',
        parts: { admin: 'http://localhost/sandbox-unload/admin.mjs' },
      }),
    );

    await loadSandboxedPlugin('http://localhost/sandbox-unload/manifest.json');

    const container = document.getElementById('rioku-plugin-sandbox-container');
    expect(container?.querySelector('[data-plugin-name="sandbox-unload"]')).not.toBeNull();

    await unloadPlugin('sandbox-unload');

    expect(container?.querySelector('[data-plugin-name="sandbox-unload"]')).toBeNull();
    expect(usePluginRegistry.getState().getPlugin('sandbox-unload')).toBeUndefined();
  });

  // ── Test 9: capped maxVersion below host ────────────────────────────────────

  it('returns an ABI error when plugin caps maxVersion below host', async () => {
    // Current host ABI is 1; cap at 0 → incompatible.
    stubFetch(makeManifest({ abi: { minVersion: 0, maxVersion: 0 } }));

    const result = await loadPluginFromUrl('http://localhost/old-plugin/manifest.json');

    expect(result.ok).toBe(false);
    expect(result.errors?.some((e) => e.includes('ABI incompatible'))).toBe(true);
  });

  // ── Test 10: dynamic import throws (bundle fetch/exec failure) ──────────────

  it('surfaces a clean error when the admin bundle import throws', async () => {
    stubFetch(makeManifest({ name: 'bundle-fail' }));
    _setPluginImporterForTest((_url: string) => Promise.reject(new Error('network collapsed')));

    const result = await loadPluginFromUrl('http://localhost/bundle-fail/manifest.json');

    expect(result.ok).toBe(false);
    expect(result.errors?.some((e) => e.includes('failed to load admin bundle'))).toBe(true);
    expect(result.errors?.some((e) => e.includes('network collapsed'))).toBe(true);
    // Plugin must not leak into the registry on import failure.
    expect(usePluginRegistry.getState().getPlugin('bundle-fail')).toBeUndefined();
  });

  // ── Test 11: non-function default export ────────────────────────────────────

  it('rejects a plugin whose default export is not a function', async () => {
    stubFetch(makeManifest({ name: 'not-callable' }));
    _setPluginImporterForTest((_url: string) =>
      Promise.resolve({ default: { notAFunction: true } }),
    );

    const result = await loadPluginFromUrl('http://localhost/not-callable/manifest.json');

    expect(result.ok).toBe(false);
    expect(result.errors?.some((e) => e.includes('no default export'))).toBe(true);
  });

  // ── Test 12: failing plugin is isolated from coexisting plugins ─────────────

  it('does not disturb an already-registered plugin when a second plugin throws', async () => {
    // First plugin loads successfully…
    setMockPlugin((host) => {
      host.sidebar.register({
        group: 'plugins',
        label: 'Good',
        path: '/plugins/good',
        source: 'plugin',
        pluginName: 'good-plugin',
      });
    });
    stubFetch(makeManifest({ name: 'good-plugin' }));
    const goodResult = await loadPluginFromUrl('http://localhost/good/manifest.json');
    expect(goodResult.ok).toBe(true);

    // …then a second plugin throws during register.
    setMockPlugin(() => {
      throw new Error('second plugin broken');
    });
    stubFetch(makeManifest({ name: 'bad-plugin' }));
    const badResult = await loadPluginFromUrl('http://localhost/bad/manifest.json');

    expect(badResult.ok).toBe(false);
    // Good plugin still present; bad plugin not leaked.
    expect(usePluginRegistry.getState().getPlugin('good-plugin')).toBeDefined();
    expect(usePluginRegistry.getState().getPlugin('bad-plugin')).toBeUndefined();
    expect(listSidebarEntries('plugins').some((e) => e.path === '/plugins/good')).toBe(true);
  });
});
