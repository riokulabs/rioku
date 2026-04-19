import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSidebarEntry,
  unregisterSidebarEntry,
  listSidebarEntries,
} from './sidebar';
import type { SidebarGroup } from './sidebar';

const registeredIds: string[] = [];

function reg(group: SidebarGroup, path: string, label = 'Label', order?: number): string {
  const id = registerSidebarEntry({
    group,
    path,
    label,
    source: 'plugin',
    pluginName: 'test',
    ...(order !== undefined ? { order } : {}),
  });
  registeredIds.push(id);
  return id;
}

beforeEach(() => {
  while (registeredIds.length > 0) {
    const id = registeredIds.pop();
    if (id !== undefined) unregisterSidebarEntry(id);
  }
});

describe('registerSidebarEntry', () => {
  it('returns an id', () => {
    const id = reg('plugins', '/plugins/hello');
    expect(typeof id).toBe('string');
  });

  it('rejects duplicate group+path combination', () => {
    const id1 = reg('plugins', '/plugins/dup');
    const id2 = reg('plugins', '/plugins/dup');
    expect(id1).toBe(id2);
    expect(listSidebarEntries('plugins').filter((e) => e.path === '/plugins/dup')).toHaveLength(1);
  });

  it('allows same path in different groups', () => {
    const id1 = reg('general', '/shared');
    const id2 = reg('security', '/shared');
    expect(id1).not.toBe(id2);
    expect(listSidebarEntries('general').find((e) => e.path === '/shared')).toBeDefined();
    expect(listSidebarEntries('security').find((e) => e.path === '/shared')).toBeDefined();
  });
});

describe('listSidebarEntries', () => {
  it('filters by group', () => {
    reg('plugins', '/plugins/a', 'A');
    reg('general', '/general/b', 'B');
    const plugins = listSidebarEntries('plugins');
    expect(plugins.every((e) => e.group === 'plugins')).toBe(true);
  });

  it('sorts by order then label', () => {
    reg('plugins', '/plugins/z', 'Zebra', 1);
    reg('plugins', '/plugins/a', 'Alpha', 2);
    reg('plugins', '/plugins/m', 'Mango', 1);
    const entries = listSidebarEntries('plugins');
    // order=1 entries come first, then sorted by label within same order
    expect(entries[0]?.label).toBe('Mango');  // order=1, label M
    expect(entries[1]?.label).toBe('Zebra');  // order=1, label Z
    expect(entries[2]?.label).toBe('Alpha');  // order=2
  });

  it('returns all entries when no group given', () => {
    reg('plugins', '/plugins/p');
    reg('general', '/general/g');
    expect(listSidebarEntries().length).toBeGreaterThanOrEqual(2);
  });
});

describe('unregisterSidebarEntry', () => {
  it('removes the entry', () => {
    const id = reg('plugins', '/plugins/rm');
    expect(listSidebarEntries('plugins').find((e) => e.path === '/plugins/rm')).toBeDefined();
    unregisterSidebarEntry(id);
    const idx = registeredIds.indexOf(id);
    if (idx !== -1) registeredIds.splice(idx, 1);
    expect(listSidebarEntries('plugins').find((e) => e.path === '/plugins/rm')).toBeUndefined();
  });

  it('no-ops for unknown id', () => {
    expect(() => { unregisterSidebarEntry('ghost'); }).not.toThrow();
  });
});
