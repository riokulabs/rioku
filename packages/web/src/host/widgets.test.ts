import { describe, it, expect, beforeEach } from 'vitest';
import { registerWidget, unregisterWidget, listWidgets } from './widgets';

beforeEach(() => {
  listWidgets().forEach((w) => {
    unregisterWidget(w.type);
  });
});

function regWidget(type: string, source: 'first-party' | 'plugin' = 'plugin'): void {
  registerWidget({
    type,
    displayName: `Widget ${type}`,
    schema: { input: null, config: null },
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    component: (() => null) as any,
    source,
  });
}

describe('registerWidget', () => {
  it('adds a widget type', () => {
    regWidget('metric-card');
    expect(listWidgets().find((w) => w.type === 'metric-card')).toBeDefined();
  });

  it('overwrites widget with same type', () => {
    regWidget('chart');
    registerWidget({
      type: 'chart',
      displayName: 'Updated Chart',
      schema: { input: null, config: null },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      component: (() => null) as any,
      source: 'plugin',
    });
    const widgets = listWidgets().filter((w) => w.type === 'chart');
    expect(widgets).toHaveLength(1);
    expect(widgets[0]?.displayName).toBe('Updated Chart');
  });
});

describe('listWidgets', () => {
  it('returns empty array when none registered', () => {
    expect(listWidgets()).toEqual([]);
  });

  it('returns all widget types', () => {
    regWidget('type-a');
    regWidget('type-b');
    expect(listWidgets()).toHaveLength(2);
  });
});

describe('unregisterWidget', () => {
  it('removes the widget type', () => {
    regWidget('removable');
    unregisterWidget('removable');
    expect(listWidgets().find((w) => w.type === 'removable')).toBeUndefined();
  });

  it('no-ops for unknown type', () => {
    expect(() => {
      unregisterWidget('ghost');
    }).not.toThrow();
  });
});
