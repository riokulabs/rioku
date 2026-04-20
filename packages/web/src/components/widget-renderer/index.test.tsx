/**
 * <WidgetRenderer> dispatcher tests — built-in lookup, plugin-lookup fallback,
 * unknown-kind error.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { WidgetRenderer } from './index';
import {
  registerWidget,
  unregisterWidget,
} from '@/host/widgets';
import type { Widget } from '@/api/resources/types';

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

function makeWidget(kind: string, overrides: Partial<Widget> = {}): Widget {
  return {
    id: 'w-1',
    dashboard_id: 'd-1',
    kind,
    title: 'Test widget',
    config: { foo: 'bar' },
    position: { x: 0, y: 0, w: 4, h: 3 },
    data_source: 'mock',
    raw_query: '',
    locked_advanced: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('<WidgetRenderer>', () => {
  afterEach(() => {
    unregisterWidget('test.plugin.widget');
  });

  it('renders a built-in widget when kind matches', () => {
    const widget = makeWidget('single-stat');
    wrap(
      <WidgetRenderer
        widget={widget}
        data={{ value: 42 }}
        loading={false}
      />,
    );
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders a plugin-registered widget when kind is not built-in', () => {
    registerWidget({
      type: 'test.plugin.widget',
      displayName: 'Test Plugin Widget',
      schema: { input: {}, config: {} },
      component: ({ data, config }) => (
        <div data-testid="plugin-widget">
          data={String((data as { v?: number } | null)?.v ?? 'none')}
          config={String((config as { foo?: string }).foo ?? 'none')}
        </div>
      ),
      source: 'plugin',
      pluginName: 'test-plugin',
    });
    const widget = makeWidget('test.plugin.widget');
    wrap(
      <WidgetRenderer
        widget={widget}
        data={{ v: 7 }}
        loading={false}
      />,
    );
    const node = screen.getByTestId('plugin-widget');
    expect(node).toHaveTextContent('data=7');
    expect(node).toHaveTextContent('config=bar');
  });

  it('renders an error Alert for an unknown widget kind', () => {
    const widget = makeWidget('mystery-kind');
    wrap(
      <WidgetRenderer
        widget={widget}
        data={null}
        loading={false}
      />,
    );
    expect(screen.getByText('Unknown widget type')).toBeInTheDocument();
    expect(screen.getByText('mystery-kind')).toBeInTheDocument();
  });
});
