import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSettingsPanel,
  unregisterSettingsPanel,
  listSettingsPanels,
} from './settings';

const registeredIds: string[] = [];

function reg(section: string, source: 'first-party' | 'plugin' = 'plugin', order?: number): string {
  const id = registerSettingsPanel({
    section,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    component: (() => null) as any,
    scope: 'tenant',
    source,
    ...(order !== undefined ? { order } : {}),
  });
  registeredIds.push(id);
  return id;
}

beforeEach(() => {
  while (registeredIds.length > 0) {
    const id = registeredIds.pop();
    if (id !== undefined) unregisterSettingsPanel(id);
  }
});

describe('registerSettingsPanel', () => {
  it('returns an id', () => {
    const id = reg('general');
    expect(typeof id).toBe('string');
  });

  it('allows multiple panels in the same section', () => {
    reg('general');
    reg('general');
    expect(listSettingsPanels('general').length).toBeGreaterThanOrEqual(2);
  });
});

describe('listSettingsPanels', () => {
  it('filters by section', () => {
    reg('general');
    reg('security');
    const general = listSettingsPanels('general');
    expect(general.every((p) => p.section === 'general')).toBe(true);
  });

  it('sorts first-party before plugin within same order', () => {
    reg('general', 'plugin');
    reg('general', 'first-party');
    const panels = listSettingsPanels('general');
    expect(panels[0]?.source).toBe('first-party');
    expect(panels[1]?.source).toBe('plugin');
  });

  it('returns all when no section given', () => {
    reg('a');
    reg('b');
    expect(listSettingsPanels().length).toBeGreaterThanOrEqual(2);
  });
});

describe('unregisterSettingsPanel', () => {
  it('removes the panel', () => {
    const id = reg('test-section');
    expect(listSettingsPanels('test-section')).toHaveLength(1);
    unregisterSettingsPanel(id);
    const idx = registeredIds.indexOf(id);
    if (idx !== -1) registeredIds.splice(idx, 1);
    expect(listSettingsPanels('test-section')).toHaveLength(0);
  });

  it('no-ops for unknown id', () => {
    expect(() => { unregisterSettingsPanel('ghost'); }).not.toThrow();
  });
});
