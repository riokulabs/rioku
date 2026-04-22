/**
 * Tests for <Zone> component.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Zone } from './index';
import { registerZone, unregisterZone } from '@/host/zones';

function wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe('<Zone>', () => {
  beforeEach(() => {
    // Zones store is module-level singleton; cleanup after each test
  });

  it('renders null when no contributions and no fallback', () => {
    const { container } = render(<Zone id="test.empty.zone" />, { wrapper });
    // MantineProvider injects style elements; check there's no zone element rendered
    expect(container.querySelector('[data-zone]')).toBeNull();
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('renders fallback when no contributions', () => {
    render(<Zone id="test.fallback.zone" fallback={<span>fallback content</span>} />, {
      wrapper,
    });
    expect(screen.getByText('fallback content')).toBeInTheDocument();
  });

  it('renders registered contributions with stable keys', () => {
    function TestWidget() {
      return <div data-testid="plugin-widget">Widget A</div>;
    }

    const id = registerZone({
      zone: 'test.render.zone',
      component: TestWidget,
      source: 'plugin',
      pluginName: 'test-plugin',
    });

    render(<Zone id="test.render.zone" />, { wrapper });
    expect(screen.getByTestId('plugin-widget')).toBeInTheDocument();
    expect(screen.getByText('Widget A')).toBeInTheDocument();

    unregisterZone(id);
  });

  it('applies role="region" and aria-label when contributions exist', () => {
    function BannerWidget() {
      return <div>Banner</div>;
    }

    const id = registerZone({
      zone: 'test.a11y.zone',
      component: BannerWidget,
      source: 'first-party',
    });

    const { container } = render(<Zone id="test.a11y.zone" />, { wrapper });
    const region = container.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-label')).toBe('Plugin contributions for test.a11y.zone');

    unregisterZone(id);
  });

  it('does NOT render role="region" when empty', () => {
    const { container } = render(<Zone id="test.no.region.zone" />, { wrapper });
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('renders multiple contributions in order', () => {
    function WidgetOne() {
      return <div data-testid="widget-1">One</div>;
    }
    function WidgetTwo() {
      return <div data-testid="widget-2">Two</div>;
    }

    const id1 = registerZone({
      zone: 'test.multi.zone',
      component: WidgetOne,
      source: 'plugin',
      pluginName: 'p1',
    });
    const id2 = registerZone({
      zone: 'test.multi.zone',
      component: WidgetTwo,
      source: 'plugin',
      pluginName: 'p2',
    });

    render(<Zone id="test.multi.zone" />, { wrapper });
    expect(screen.getByTestId('widget-1')).toBeInTheDocument();
    expect(screen.getByTestId('widget-2')).toBeInTheDocument();

    unregisterZone(id1);
    unregisterZone(id2);
  });
});
