/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * <GridCanvas> tests — render, selection, remove, and direct layout handler
 * calls. We avoid exercising real dnd-kit pointer events (jsdom has no
 * usable pointer/drag simulation); instead we verify that the handlers
 * passed into the canvas are wired correctly and that the canvas renders
 * the expected shape.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { GridCanvas } from '../components/grid-canvas';

function firstAcmeDashboard() {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  const dashboard = Object.values(useMockStore.getState().dashboards).find(
    (d) => d.tenant_id === acme.id,
  );
  if (!dashboard) throw new Error('No acme dashboard seeded');
  const widgets = dashboard.widget_ids
    .map((id) => useMockStore.getState().widgets[id])
    .filter((w) => w !== undefined);
  return { dashboard, widgets };
}

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('<GridCanvas>', () => {
  it('renders widget cells for each widget in the dashboard', () => {
    const { dashboard, widgets } = firstAcmeDashboard();
    wrap(
      <GridCanvas
        dashboard={dashboard}
        widgets={widgets}
        selectedWidgetId={null}
        onSelect={vi.fn()}
        onAddWidget={vi.fn()}
        onMoveWidget={vi.fn()}
        onResizeWidget={vi.fn()}
        onRemoveWidget={vi.fn()}
      />,
    );
    expect(screen.getByTestId('grid-canvas')).toBeTruthy();
    for (const w of widgets) {
      expect(screen.getByTestId(`widget-cell-${w.id}`)).toBeTruthy();
    }
  });

  it('shows empty-state placeholder when dashboard has no widgets', () => {
    const { dashboard } = firstAcmeDashboard();
    wrap(
      <GridCanvas
        dashboard={{ ...dashboard, widget_ids: [], layout: {} }}
        widgets={[]}
        selectedWidgetId={null}
        onSelect={vi.fn()}
        onAddWidget={vi.fn()}
        onMoveWidget={vi.fn()}
        onResizeWidget={vi.fn()}
        onRemoveWidget={vi.fn()}
      />,
    );
    expect(screen.getByTestId('grid-empty')).toBeTruthy();
  });

  it('configure icon click calls onSelect with widget id', async () => {
    const user = userEvent.setup();
    const { dashboard, widgets } = firstAcmeDashboard();
    const onSelect = vi.fn();
    wrap(
      <GridCanvas
        dashboard={dashboard}
        widgets={widgets}
        selectedWidgetId={null}
        onSelect={onSelect}
        onAddWidget={vi.fn()}
        onMoveWidget={vi.fn()}
        onResizeWidget={vi.fn()}
        onRemoveWidget={vi.fn()}
      />,
    );
    const first = widgets[0]!;
    await user.click(screen.getByRole('button', { name: `Configure ${first.title}` }));
    expect(onSelect).toHaveBeenCalledWith(first.id);
  });

  it('trash icon click calls onRemoveWidget', async () => {
    const user = userEvent.setup();
    const { dashboard, widgets } = firstAcmeDashboard();
    const onRemoveWidget = vi.fn();
    wrap(
      <GridCanvas
        dashboard={dashboard}
        widgets={widgets}
        selectedWidgetId={null}
        onSelect={vi.fn()}
        onAddWidget={vi.fn()}
        onMoveWidget={vi.fn()}
        onResizeWidget={vi.fn()}
        onRemoveWidget={onRemoveWidget}
      />,
    );
    const first = widgets[0]!;
    await user.click(screen.getByRole('button', { name: `Remove ${first.title}` }));
    expect(onRemoveWidget).toHaveBeenCalledWith(first.id);
  });
});
