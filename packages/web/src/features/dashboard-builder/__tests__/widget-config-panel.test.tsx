/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * <WidgetConfigPanel> tests — render happy path, title commit, and the
 * locked-advanced placeholder branch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

// Monaco is lazy-loaded by AdvancedEditor. Stub with a plain textarea so
// jsdom doesn't choke on ResizeObserver / workers.
vi.mock('@monaco-editor/react', () => {
  const MockEditor = ({
    value,
    onChange,
    options,
  }: {
    value?: string;
    onChange?: (v: string | undefined) => void;
    options?: { readOnly?: boolean };
  }) => (
    <textarea
      data-testid="monaco-stub"
      aria-label="advanced-query-editor"
      value={value ?? ''}
      readOnly={options?.readOnly ?? false}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
  return { default: MockEditor };
});
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import type { Widget } from '@/api/resources/types';
import { WidgetConfigPanel } from '../components/widget-config-panel';

function firstWidget(): Widget {
  const widgets = Object.values(useMockStore.getState().widgets);
  if (widgets.length === 0) throw new Error('no widgets seeded');
  return widgets[0]!;
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
  const derrick = Object.values(useMockStore.getState().users).find(
    (u) => u.email === 'derrick@acme.com',
  );
  useMockStore.setState({ currentUserId: derrick?.id ?? 'user-0000' });
});

describe('<WidgetConfigPanel>', () => {
  it('renders inline-edit title + the wizard for a standard widget', () => {
    const widget = firstWidget();
    wrap(
      <WidgetConfigPanel
        dashboardId={widget.dashboard_id}
        widget={widget}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const titleInput = screen.getByLabelText('Widget title');
    expect((titleInput as HTMLInputElement).value).toBe(widget.title);
    // Wizard stepper is rendered.
    expect(screen.getByText('Pick a source')).toBeTruthy();
  });

  it('commits rename on blur', async () => {
    const user = userEvent.setup();
    const widget = firstWidget();
    const onSave = vi.fn();
    wrap(
      <WidgetConfigPanel
        dashboardId={widget.dashboard_id}
        widget={widget}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const titleInput = screen.getByLabelText('Widget title');
    await user.clear(titleInput);
    await user.type(titleInput, 'Renamed widget');
    await user.tab();
    await vi.waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    const saved = onSave.mock.calls[0]![0] as { title: string };
    expect(saved.title).toBe('Renamed widget');
  });

  it('shows advanced editor for locked widgets', () => {
    const widget = firstWidget();
    wrap(
      <WidgetConfigPanel
        dashboardId={widget.dashboard_id}
        widget={{ ...widget, locked_advanced: true }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/Advanced mode/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('advanced-editor')).toBeTruthy();
    // Save button lands disabled (no dirty change yet).
    expect(
      (screen.getByTestId('advanced-editor-save') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('close button calls onClose', async () => {
    const user = userEvent.setup();
    const widget = firstWidget();
    const onClose = vi.fn();
    wrap(
      <WidgetConfigPanel
        dashboardId={widget.dashboard_id}
        widget={widget}
        onSave={vi.fn()}
        onClose={onClose}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Close widget config' }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
