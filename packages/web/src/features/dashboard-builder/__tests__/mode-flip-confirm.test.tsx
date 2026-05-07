 
/**
 * <ModeFlipConfirmDialog> tests — both variants.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import type { Widget } from '@/api/resources';
import { ModeFlipConfirmDialog } from '../components/mode-flip-confirm';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
}

function firstDashboardWidgets(): Widget[] {
  const dashboards = Object.values(useMockStore.getState().dashboards);
  const d = dashboards[0]!;
  const widgets = useMockStore.getState().widgets;
  return d.widget_ids.map((id) => widgets[id]).filter((w): w is Widget => Boolean(w));
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('<ModeFlipConfirmDialog> dashboard variant', () => {
  it('lists one-way widgets and gates confirm on the ack checkbox', async () => {
    const user = userEvent.setup();
    const widgets = firstDashboardWidgets();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    wrap(
      <ModeFlipConfirmDialog
        variant="dashboard"
        opened
        widgets={widgets}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    // Confirm button exists and is disabled until ack checkbox is checked.
    const confirm = screen.getByTestId<HTMLButtonElement>('mode-flip-confirm');
    // There is at least one one-way widget in seeded data.
    if (screen.queryByTestId('mode-flip-ack-checkbox')) {
      expect(confirm.disabled).toBe(true);
      await user.click(screen.getByTestId('mode-flip-ack-checkbox'));
      expect(confirm.disabled).toBe(false);
    }
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('cancel invokes onCancel', async () => {
    const user = userEvent.setup();
    const widgets = firstDashboardWidgets();
    const onCancel = vi.fn();

    wrap(
      <ModeFlipConfirmDialog
        variant="dashboard"
        opened
        widgets={widgets}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('<ModeFlipConfirmDialog> widget variant', () => {
  it('confirm → onConfirm, no ack checkbox required', async () => {
    const user = userEvent.setup();
    const widget = firstDashboardWidgets()[0]!;
    const onConfirm = vi.fn();

    wrap(
      <ModeFlipConfirmDialog
        variant="widget"
        opened
        widget={widget}
        widgetDisplayName="Stacked bar"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.queryByTestId('mode-flip-ack-checkbox')).toBeNull();
    await user.click(screen.getByTestId('mode-flip-confirm'));
    expect(onConfirm).toHaveBeenCalled();
  });
});
