/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * <AdvancedEditor> tests — fallback render, flip-to-wizard visibility,
 * save/preview flows, and locked-one-way gating.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import type { Widget } from '@/api/resources/types';
import { AdvancedEditor } from '../components/advanced-editor';

// Lazy-loaded Monaco stubbed as a plain textarea.
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

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
}

function firstCleanWidget(): Widget {
  const widgets = Object.values(useMockStore.getState().widgets);
  const found = widgets.find((w) => w.kind === 'single-stat');
  if (!found) throw new Error('no single-stat widget seeded');
  return found;
}

function firstOneWayWidget(): Widget {
  const widgets = Object.values(useMockStore.getState().widgets);
  const found = widgets.find((w) => w.kind === 'stacked-bar' || w.kind === 'table');
  if (!found) throw new Error('no one-way widget seeded');
  return found;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  // seedStore already wires currentUserId = derrick + currentTenantId = acme.
});

describe('<AdvancedEditor>', () => {
  it('renders the editor host and a Save button', async () => {
    const widget = firstCleanWidget();
    wrap(<AdvancedEditor widget={widget} onSave={vi.fn()} />);
    expect(await screen.findByTestId('advanced-editor')).toBeTruthy();
    expect(screen.getByTestId('advanced-editor-save')).toBeTruthy();
  });

  it('Save button enables only when the query changes', async () => {
    const user = userEvent.setup();
    const widget = firstCleanWidget();
    wrap(<AdvancedEditor widget={widget} onSave={vi.fn()} />);

    const save = (await screen.findByTestId(
      'advanced-editor-save',
    )) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    const editor = await screen.findByTestId('monaco-stub');
    await user.clear(editor);
    await user.type(editor, 'null');
    expect(save.disabled).toBe(false);
  });

  it('Save calls updateWidget and bubbles via onSave', async () => {
    const user = userEvent.setup();
    const widget = firstCleanWidget();
    const onSave = vi.fn();
    wrap(<AdvancedEditor widget={widget} onSave={onSave} />);

    const editor = await screen.findByTestId('monaco-stub');
    await user.clear(editor);
    await user.type(editor, 'null');
    await user.click(await screen.findByTestId('advanced-editor-save'));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    const saved = onSave.mock.calls[0]![0] as Widget;
    expect(saved.raw_query).toBe('null');
  });

  it('shows flip-to-wizard for clean widgets and hides for one-way', async () => {
    const clean = firstCleanWidget();
    const oneWay = firstOneWayWidget();

    const { rerender } = wrap(<AdvancedEditor widget={clean} onSave={vi.fn()} />);
    expect(
      await screen.findByTestId('advanced-editor-flip-to-wizard'),
    ).toBeTruthy();

    rerender(
      <MantineProvider>
        <Notifications />
        <AdvancedEditor widget={oneWay} onSave={vi.fn()} />
      </MantineProvider>,
    );
    expect(screen.queryByTestId('advanced-editor-flip-to-wizard')).toBeNull();
  });

  it('flip-to-wizard button hidden when widget is locked_advanced', async () => {
    const widget = firstCleanWidget();
    wrap(
      <AdvancedEditor
        widget={{ ...widget, locked_advanced: true }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('advanced-editor-flip-to-wizard')).toBeNull();
  });

  it('Preview button renders the widget renderer', async () => {
    const user = userEvent.setup();
    const widget = firstCleanWidget();
    wrap(<AdvancedEditor widget={widget} onSave={vi.fn()} />);
    await user.click(await screen.findByTestId('advanced-editor-preview'));
    expect(
      await screen.findByTestId('advanced-editor-preview-pane'),
    ).toBeTruthy();
  });
});
