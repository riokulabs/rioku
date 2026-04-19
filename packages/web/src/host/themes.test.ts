import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerPluginTheme,
  unregisterPluginTheme,
  listPluginThemes,
} from './themes';
import type { RegisteredTheme } from '@/theme';

function makeTheme(name: string): RegisteredTheme {
  return {
    name,
    displayName: `Theme ${name}`,
    colorScheme: 'dark',
    theme: {},
    source: 'plugin',
  };
}

beforeEach(() => {
  listPluginThemes().forEach((t) => { unregisterPluginTheme(t.name); });
});

describe('registerPluginTheme', () => {
  it('adds a theme to the registry', () => {
    registerPluginTheme(makeTheme('my-dark'));
    expect(listPluginThemes().find((t) => t.name === 'my-dark')).toBeDefined();
  });

  it('returns the theme name', () => {
    const name = registerPluginTheme(makeTheme('my-theme'));
    expect(name).toBe('my-theme');
  });

  it('overwrites existing theme with same name', () => {
    registerPluginTheme(makeTheme('overwrite-me'));
    const updated = { ...makeTheme('overwrite-me'), displayName: 'Updated' };
    registerPluginTheme(updated);
    const themes = listPluginThemes().filter((t) => t.name === 'overwrite-me');
    expect(themes).toHaveLength(1);
    expect(themes[0]?.displayName).toBe('Updated');
  });
});

describe('listPluginThemes', () => {
  it('returns empty array when none registered', () => {
    expect(listPluginThemes()).toEqual([]);
  });

  it('returns all registered themes', () => {
    registerPluginTheme(makeTheme('alpha'));
    registerPluginTheme(makeTheme('beta'));
    expect(listPluginThemes()).toHaveLength(2);
  });
});

describe('unregisterPluginTheme', () => {
  it('removes the theme by name', () => {
    registerPluginTheme(makeTheme('removable'));
    unregisterPluginTheme('removable');
    expect(listPluginThemes().find((t) => t.name === 'removable')).toBeUndefined();
  });

  it('no-ops for unknown name', () => {
    expect(() => { unregisterPluginTheme('ghost'); }).not.toThrow();
  });
});
