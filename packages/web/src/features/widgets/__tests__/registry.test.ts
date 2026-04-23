/**
 * Registry tests — asserts the 15 built-in types are present, each entry has
 * a component, and the roundTripMode is correctly assigned.
 *
 * The 10 original Plan-4 kinds (single-stat, sparkline, time-series,
 * stacked-bar, table, pie, service-map, log-viewer, audit-tail, top-n) were
 * extended with 5 richer kinds (kpi-card, gauge, heatmap, area-chart,
 * status-grid) when the Overview dashboard was rebuilt to cover the whole
 * Rioku system.
 */
import { describe, expect, it } from 'vitest';
import { BUILT_IN_WIDGETS, BUILT_IN_WIDGET_IDS, getBuiltInWidget } from '../registry';

describe('BUILT_IN_WIDGETS registry', () => {
  it('registers all 15 built-in widget types', () => {
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
      'kpi-card',
      'gauge',
      'heatmap',
      'area-chart',
      'status-grid',
    ];
    for (const key of expected) {
      expect(BUILT_IN_WIDGETS[key]).toBeDefined();
    }
    expect(BUILT_IN_WIDGET_IDS).toHaveLength(15);
  });

  it('every definition exposes a component and display name', () => {
    for (const def of Object.values(BUILT_IN_WIDGETS)) {
      expect(typeof def.displayName).toBe('string');
      expect(def.displayName.length).toBeGreaterThan(0);
      expect(typeof def.component).toBe('function');
    }
  });

  it('marks single-stat / sparkline / time-series / kpi-card / gauge as clean round-trip', () => {
    expect(BUILT_IN_WIDGETS['single-stat']?.roundTripMode).toBe('clean');
    expect(BUILT_IN_WIDGETS.sparkline?.roundTripMode).toBe('clean');
    expect(BUILT_IN_WIDGETS['time-series']?.roundTripMode).toBe('clean');
    expect(BUILT_IN_WIDGETS['kpi-card']?.roundTripMode).toBe('clean');
    expect(BUILT_IN_WIDGETS.gauge?.roundTripMode).toBe('clean');
  });

  it('marks non-trivial kinds (stacked-bar, table, pie, service-map, log-viewer, audit-tail, top-n, heatmap, area-chart, status-grid) as one-way', () => {
    const oneWay = [
      'stacked-bar',
      'table',
      'pie',
      'service-map',
      'log-viewer',
      'audit-tail',
      'top-n',
      'heatmap',
      'area-chart',
      'status-grid',
    ];
    for (const k of oneWay) {
      expect(BUILT_IN_WIDGETS[k]?.roundTripMode).toBe('one-way');
    }
  });

  it('getBuiltInWidget returns undefined for unknown kind', () => {
    expect(getBuiltInWidget('not-a-kind')).toBeUndefined();
  });
});
