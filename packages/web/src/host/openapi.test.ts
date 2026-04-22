import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerPluginOpenApi,
  unregisterPluginOpenApi,
  listPluginOpenApiContribs,
} from './openapi';

beforeEach(() => {
  listPluginOpenApiContribs().forEach((c) => {
    unregisterPluginOpenApi(c.pluginName);
  });
});

describe('registerPluginOpenApi', () => {
  it('adds a contribution', () => {
    registerPluginOpenApi({ pluginName: 'my-plugin', spec: { openapi: '3.1.0' } });
    expect(listPluginOpenApiContribs().find((c) => c.pluginName === 'my-plugin')).toBeDefined();
  });

  it('overwrites existing contribution from same plugin', () => {
    registerPluginOpenApi({ pluginName: 'my-plugin', spec: { openapi: '3.0.0' } });
    registerPluginOpenApi({ pluginName: 'my-plugin', spec: { openapi: '3.1.0' } });
    const contribs = listPluginOpenApiContribs().filter((c) => c.pluginName === 'my-plugin');
    expect(contribs).toHaveLength(1);
    const spec = contribs[0]?.spec as { openapi: string } | undefined;
    expect(spec?.openapi).toBe('3.1.0');
  });
});

describe('listPluginOpenApiContribs', () => {
  it('returns empty array when none registered', () => {
    expect(listPluginOpenApiContribs()).toEqual([]);
  });

  it('returns all contributions', () => {
    registerPluginOpenApi({ pluginName: 'plugin-a', spec: {} });
    registerPluginOpenApi({ pluginName: 'plugin-b', spec: {} });
    expect(listPluginOpenApiContribs()).toHaveLength(2);
  });
});

describe('unregisterPluginOpenApi', () => {
  it('removes the contribution', () => {
    registerPluginOpenApi({ pluginName: 'removable', spec: {} });
    unregisterPluginOpenApi('removable');
    expect(listPluginOpenApiContribs().find((c) => c.pluginName === 'removable')).toBeUndefined();
  });

  it('no-ops for unknown plugin', () => {
    expect(() => {
      unregisterPluginOpenApi('ghost');
    }).not.toThrow();
  });
});
