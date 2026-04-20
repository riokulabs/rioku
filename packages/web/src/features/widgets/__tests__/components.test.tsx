/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Widget component smoke tests — each of the 10 built-in widgets renders its
 * happy path, loading skeleton, and error alert without crashing.
 */
import { describe, expect, it } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { render } from '@testing-library/react';
import { BUILT_IN_WIDGETS } from '../registry';
import type { Widget } from '@/api/resources/types';
import type { WidgetRenderProps } from '../types';

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

function makeWidget(kind: string): Widget {
  return {
    id: `w-${kind}`,
    dashboard_id: 'dash-1',
    kind,
    title: `Test ${kind}`,
    config: {},
    position: { x: 0, y: 0, w: 4, h: 3 },
    data_source: 'mock',
    raw_query: '',
    locked_advanced: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

/** Per-kind sample data that satisfies each component's type guard. */
const SAMPLE_DATA: Record<string, unknown> = {
  'single-stat': { value: 1234, delta: 12, unit: 'req/s' },
  sparkline: { points: [{ x: 0, y: 10 }, { x: 1, y: 15 }, { x: 2, y: 9 }] },
  'time-series': {
    points: [
      { x: '2026-01-01', y: 1 },
      { x: '2026-01-02', y: 3 },
    ],
    series: 'count',
  },
  'stacked-bar': {
    categories: [
      { label: 'A', s1: 10, s2: 5 },
      { label: 'B', s1: 7, s2: 8 },
    ],
    series: [{ name: 's1' }, { name: 's2' }],
  },
  table: { rows: [{ a: 1, b: 'x' }, { a: 2, b: 'y' }] },
  pie: {
    slices: [
      { name: 'A', value: 60 },
      { name: 'B', value: 40 },
    ],
  },
  'service-map': {
    nodes: [
      { id: 'n1', label: 'svc1' },
      { id: 'n2', label: 'svc2' },
    ],
    edges: [{ from: 'n1', to: 'n2' }],
  },
  'log-viewer': {
    lines: [
      { level: 'info', ts: '2026-01-01T00:00:00Z', msg: 'hello' },
      { level: 'error', ts: '2026-01-01T00:00:01Z', msg: 'boom' },
    ],
  },
  'audit-tail': {
    entries: [
      { id: 'a1', at: '2026-01-01T00:00:00Z', action: 'test', actor_id: 'u1', outcome: 'success' },
    ],
  },
  'top-n': { items: [{ name: 'one', value: 100 }, { name: 'two', value: 50 }] },
};

function renderWidget(kind: string, overrides: Partial<WidgetRenderProps> = {}) {
  const def = BUILT_IN_WIDGETS[kind];
  if (!def) throw new Error(`No registry entry for ${kind}`);
  const Component = def.component;
  const props: WidgetRenderProps = {
    widget: makeWidget(kind),
    data: SAMPLE_DATA[kind],
    loading: false,
    ...overrides,
  };
  return wrap(<Component {...props} />);
}

describe.each(Object.keys(BUILT_IN_WIDGETS))('widget component: %s', (kind) => {
  it('renders happy path without throwing', () => {
    const { container } = renderWidget(kind);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders loading skeleton', () => {
    const { container } = renderWidget(kind, { data: undefined, loading: true });
    expect(container.firstChild).not.toBeNull();
  });

  it('renders error alert', () => {
    const { getByText } = renderWidget(kind, {
      data: undefined,
      loading: false,
      error: 'boom',
    });
    expect(getByText('boom')).toBeTruthy();
  });

  it('renders invalid-data alert when data shape is wrong', () => {
    const { container } = renderWidget(kind, {
      data: { bad: 'shape' },
      loading: false,
    });
    expect(container.textContent).toContain('Invalid data');
  });
});
