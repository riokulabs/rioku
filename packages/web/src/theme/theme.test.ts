import { describe, it, expect } from 'vitest';
import { BUILTIN_THEMES } from './index';

describe('themes', () => {
  it('ships 4 built-in themes', () => {
    expect(BUILTIN_THEMES).toHaveLength(4);
  });
  it('names are unique', () => {
    const names = new Set(BUILTIN_THEMES.map((t) => t.name));
    expect(names.size).toBe(4);
  });
  it('each theme has a color scheme', () => {
    expect(BUILTIN_THEMES.every((t) => ['dark', 'light'].includes(t.colorScheme))).toBe(true);
  });
});
