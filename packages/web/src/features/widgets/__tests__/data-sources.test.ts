/**
 * Data-source adapter tests — covers all 6 built-in adapters plus the
 * wizard_state / raw_query / parse-error branches.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import {
  DATA_SOURCE_ADAPTERS,
  WidgetQueryError,
  runWidgetQuery,
} from '../data-sources';
import type { Widget } from '@/api/resources/types';

function makeWidget(partial: Partial<Widget> & { data_source: string; kind: string }): Widget {
  return {
    id: partial.id ?? 'w-1',
    dashboard_id: 'dash-1',
    kind: partial.kind,
    title: 'Test',
    config: {},
    position: { x: 0, y: 0, w: 4, h: 3 },
    data_source: partial.data_source,
    raw_query: partial.raw_query ?? '',
    locked_advanced: partial.locked_advanced ?? false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...(partial.wizard_state !== undefined ? { wizard_state: partial.wizard_state } : {}),
  };
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('runWidgetQuery', () => {
  it('throws WidgetQueryError for an unknown data source', () => {
    const w = makeWidget({ data_source: 'unknown', kind: 'table' });
    expect(() => runWidgetQuery(w, useMockStore.getState())).toThrow(WidgetQueryError);
  });

  it('registers all 6 built-in adapters', () => {
    for (const key of ['audit', 'services', 'routes', 'traces', 'notifications', 'mock']) {
      expect(DATA_SOURCE_ADAPTERS[key]).toBeDefined();
    }
  });
});

describe('mock adapter', () => {
  it('synthesises 20 deterministic rows per widget id', () => {
    const w1 = makeWidget({ id: 'w-A', data_source: 'mock', kind: 'table' });
    const w2 = makeWidget({ id: 'w-B', data_source: 'mock', kind: 'table' });
    const r1 = runWidgetQuery(w1, useMockStore.getState()) as { rows: unknown[] };
    const r2 = runWidgetQuery(w2, useMockStore.getState()) as { rows: unknown[] };
    expect(r1.rows).toHaveLength(20);
    expect(r2.rows).toHaveLength(20);
    expect(r1).not.toEqual(r2);
  });

  it('returns sparkline points for kind=sparkline', () => {
    const w = makeWidget({ data_source: 'mock', kind: 'sparkline' });
    const result = runWidgetQuery(w, useMockStore.getState()) as { points: unknown[] };
    expect(result.points).toHaveLength(20);
  });

  it('returns a single value for kind=single-stat', () => {
    const w = makeWidget({ data_source: 'mock', kind: 'single-stat' });
    const result = runWidgetQuery(w, useMockStore.getState()) as { value: number };
    expect(typeof result.value).toBe('number');
  });
});

describe('audit adapter', () => {
  it('returns audit-tail entries from seeded audit log', () => {
    const w = makeWidget({ data_source: 'audit', kind: 'audit-tail' });
    const result = runWidgetQuery(w, useMockStore.getState()) as { entries: unknown[] };
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('applies wizard_state filters', () => {
    const w = makeWidget({
      data_source: 'audit',
      kind: 'table',
      wizard_state: {
        dimensions: [],
        measures: [],
        filters: [{ field: 'outcome', op: '==', value: 'success' }],
        limit: 50,
      },
    });
    const result = runWidgetQuery(w, useMockStore.getState()) as { rows: Record<string, unknown>[] };
    expect(result.rows.every((r) => r['outcome'] === 'success')).toBe(true);
  });
});

describe('services adapter', () => {
  it('returns services rows', () => {
    const w = makeWidget({ data_source: 'services', kind: 'table' });
    const result = runWidgetQuery(w, useMockStore.getState()) as { rows: unknown[] };
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it('emits a service-map with edges', () => {
    const w = makeWidget({ data_source: 'services', kind: 'service-map' });
    const result = runWidgetQuery(w, useMockStore.getState()) as {
      nodes: unknown[];
      edges: unknown[];
    };
    expect(result.nodes.length).toBeGreaterThan(0);
    // edges = nodes.length - 1 (simple chain layout).
    expect(result.edges.length).toBe(Math.max(0, result.nodes.length - 1));
  });
});

describe('routes adapter', () => {
  it('returns routes rows', () => {
    const w = makeWidget({ data_source: 'routes', kind: 'table' });
    const result = runWidgetQuery(w, useMockStore.getState()) as { rows: unknown[] };
    expect(Array.isArray(result.rows)).toBe(true);
  });
});

describe('traces adapter', () => {
  it('returns trace rows from seeded aiTraces', () => {
    const w = makeWidget({ data_source: 'traces', kind: 'table' });
    const result = runWidgetQuery(w, useMockStore.getState()) as { rows: unknown[] };
    expect(Array.isArray(result.rows)).toBe(true);
  });
});

describe('notifications adapter', () => {
  it('returns notification rows', () => {
    const w = makeWidget({ data_source: 'notifications', kind: 'table' });
    const result = runWidgetQuery(w, useMockStore.getState()) as { rows: unknown[] };
    expect(Array.isArray(result.rows)).toBe(true);
  });
});

describe('raw_query parsing', () => {
  it('parses valid JSON raw_query and applies filters', () => {
    const w = makeWidget({
      data_source: 'mock',
      kind: 'table',
      raw_query: JSON.stringify({ filters: [{ field: 'x', op: '<', value: 5 }] }),
    });
    const result = runWidgetQuery(w, useMockStore.getState()) as { rows: Record<string, unknown>[] };
    expect(result.rows.every((r) => (r['x'] as number) < 5)).toBe(true);
  });

  it('throws WidgetQueryError with detail on invalid JSON', () => {
    const w = makeWidget({
      data_source: 'mock',
      kind: 'table',
      raw_query: '{not json',
    });
    expect(() => runWidgetQuery(w, useMockStore.getState())).toThrow(/Invalid query/);
  });

  it('throws WidgetQueryError when parsed value is not an object', () => {
    const w = makeWidget({
      data_source: 'mock',
      kind: 'table',
      raw_query: '"string"',
    });
    expect(() => runWidgetQuery(w, useMockStore.getState())).toThrow(/Invalid query/);
  });

  it('applies group_by + aggregate from raw_query on top-n', () => {
    const w = makeWidget({
      data_source: 'mock',
      kind: 'top-n',
      raw_query: JSON.stringify({
        group_by: 'label',
        aggregate: { field: 'y', op: 'sum' },
        order_by: { field: 'value', direction: 'desc' },
        limit: 5,
      }),
    });
    const result = runWidgetQuery(w, useMockStore.getState()) as { items: unknown[] };
    expect(result.items.length).toBeLessThanOrEqual(5);
  });
});
