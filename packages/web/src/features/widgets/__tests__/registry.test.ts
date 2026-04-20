/**
 * Registry tests — asserts the 10 built-in types are present, each
 * entry has a component, and the roundTripMode is correctly assigned.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_WIDGETS,
  BUILT_IN_WIDGET_IDS,
  getBuiltInWidget,
} from '../registry';

describe('BUILT_IN_WIDGETS registry', () => {
  it('registers all 10 built-in widget types', () => {
    const expected = [
      'single-stat',
      'sparkline',
      'time-series',
      'stacked-bar',
      'table',
      'pie',
      'service-map',
      'log-viewer',
      'audit-tail',
      'top-n',
    ];
    for (const key of expected) {
      expect(BUILT_IN_WIDGETS[key]).toBeDefined();
    }
    expect(BUILT_IN_WIDGET_IDS).toHaveLength(10);
  });

  it('every definition exposes a component and display name', () => {
    for (const def of Object.values(BUILT_IN_WIDGETS)) {
      expect(typeof def.displayName).toBe('string');
      expect(def.displayName.length).toBeGreaterThan(0);
      expect(typeof def.component).toBe('function');
    }
  });

  it('marks single-stat / sparkline / time-series as clean round-trip', () => {
    expect(BUILT_IN_WIDGETS['single-stat']?.roundTripMode).toBe('clean');
    expect(BUILT_IN_WIDGETS.sparkline?.roundTripMode).toBe('clean');
    expect(BUILT_IN_WIDGETS['time-series']?.roundTripMode).toBe('clean');
  });

  it('marks stacked-bar / table / pie / service-map / log-viewer / audit-tail / top-n as one-way', () => {
    const oneWay = [
      'stacked-bar',
      'table',
      'pie',
      'service-map',
      'log-viewer',
      'audit-tail',
      'top-n',
    ];
    for (const k of oneWay) {
      expect(BUILT_IN_WIDGETS[k]?.roundTripMode).toBe('one-way');
    }
  });

  it('getBuiltInWidget returns undefined for unknown kind', () => {
    expect(getBuiltInWidget('not-a-kind')).toBeUndefined();
  });
});
