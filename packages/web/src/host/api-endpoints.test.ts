import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerPluginEndpoint,
  unregisterPluginEndpoint,
  listPluginEndpoints,
} from './api-endpoints';

beforeEach(() => {
  listPluginEndpoints().forEach((e) => { unregisterPluginEndpoint(e.method, e.path); });
});

describe('registerPluginEndpoint', () => {
  it('adds an endpoint', () => {
    registerPluginEndpoint({ path: '/api/v1/foo', method: 'GET', source: 'plugin', pluginName: 'test' });
    expect(listPluginEndpoints().find((e) => e.path === '/api/v1/foo' && e.method === 'GET')).toBeDefined();
  });

  it('rejects duplicate method+path combination', () => {
    registerPluginEndpoint({ path: '/api/v1/dup', method: 'POST', source: 'plugin' });
    registerPluginEndpoint({ path: '/api/v1/dup', method: 'POST', source: 'plugin' });
    expect(listPluginEndpoints().filter((e) => e.path === '/api/v1/dup' && e.method === 'POST')).toHaveLength(1);
  });

  it('allows different methods on the same path', () => {
    registerPluginEndpoint({ path: '/api/v1/resource', method: 'GET', source: 'plugin' });
    registerPluginEndpoint({ path: '/api/v1/resource', method: 'POST', source: 'plugin' });
    expect(listPluginEndpoints().filter((e) => e.path === '/api/v1/resource')).toHaveLength(2);
  });
});

describe('listPluginEndpoints', () => {
  it('returns all endpoints when no filter', () => {
    registerPluginEndpoint({ path: '/a', method: 'GET', source: 'plugin', pluginName: 'p1' });
    registerPluginEndpoint({ path: '/b', method: 'GET', source: 'plugin', pluginName: 'p2' });
    expect(listPluginEndpoints().length).toBeGreaterThanOrEqual(2);
  });

  it('filters by pluginName', () => {
    registerPluginEndpoint({ path: '/p1/ep', method: 'GET', source: 'plugin', pluginName: 'plugin-a' });
    registerPluginEndpoint({ path: '/p2/ep', method: 'GET', source: 'plugin', pluginName: 'plugin-b' });
    const forA = listPluginEndpoints('plugin-a');
    expect(forA.every((e) => e.pluginName === 'plugin-a')).toBe(true);
  });
});

describe('unregisterPluginEndpoint', () => {
  it('removes the endpoint', () => {
    registerPluginEndpoint({ path: '/api/rm', method: 'DELETE', source: 'plugin' });
    unregisterPluginEndpoint('DELETE', '/api/rm');
    expect(listPluginEndpoints().find((e) => e.path === '/api/rm')).toBeUndefined();
  });

  it('no-ops for unknown endpoint', () => {
    expect(() => { unregisterPluginEndpoint('GET', '/ghost'); }).not.toThrow();
  });
});
