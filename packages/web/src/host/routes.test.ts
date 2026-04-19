import { describe, it, expect, beforeEach } from 'vitest';
import { registerRoute, unregisterRoute, listPluginRoutes } from './routes';

const registeredIds: string[] = [];

function reg(path: string): string {
  const id = registerRoute({
    path,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    component: (() => null) as any,
    source: 'plugin',
    pluginName: 'test',
  });
  registeredIds.push(id);
  return id;
}

beforeEach(() => {
  while (registeredIds.length > 0) {
    const id = registeredIds.pop();
    if (id !== undefined) unregisterRoute(id);
  }
});

describe('registerRoute', () => {
  it('returns an id', () => {
    const id = reg('/plugins/hello');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('rejects duplicate path — returns existing id', () => {
    const id1 = reg('/plugins/dup');
    const id2 = reg('/plugins/dup');
    expect(id1).toBe(id2);
    expect(listPluginRoutes().filter((r) => r.path === '/plugins/dup')).toHaveLength(1);
  });
});

describe('listPluginRoutes', () => {
  it('returns all registered routes', () => {
    reg('/plugins/a');
    reg('/plugins/b');
    expect(listPluginRoutes().length).toBeGreaterThanOrEqual(2);
  });
});

describe('unregisterRoute', () => {
  it('removes the route by id', () => {
    const id = reg('/plugins/remove-me');
    expect(listPluginRoutes().find((r) => r.path === '/plugins/remove-me')).toBeDefined();
    unregisterRoute(id);
    const idx = registeredIds.indexOf(id);
    if (idx !== -1) registeredIds.splice(idx, 1);
    expect(listPluginRoutes().find((r) => r.path === '/plugins/remove-me')).toBeUndefined();
  });

  it('no-ops for unknown id', () => {
    expect(() => { unregisterRoute('ghost-id'); }).not.toThrow();
  });
});
