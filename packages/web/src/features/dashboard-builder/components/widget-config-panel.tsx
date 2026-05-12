/**
 * <WidgetConfigPanel> — right-sidebar editor for the currently-selected widget.
 *
 * Behaviour matches Plan 4 §4c.17 + §4d.20:
 *
 *  - Header shows an inline-edit `<TextInput variant="unstyled">` for the
 *    widget title; commits the rename on blur / Enter.
 *  - If the widget is locked to advanced mode → renders `<AdvancedEditor>`.
 *  - Else → renders `<AskQuestionWizard mode="edit" …>` inline, scoped to
 *    the current widget, plus a "Flip to advanced" button that routes
 *    through `<ModeFlipConfirmDialog variant="widget">`.
 *  - Close button collapses the panel.
 */
import { useState } from 'react';
import { Button, Divider, Group, Stack, TextInput, ActionIcon, Tooltip } from '@mantine/core';
import { IconCode, IconX } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { BUILT_IN_WIDGETS } from '@/features/widgets/registry';
import { flipWidgetToAdvanced, updateWidget } from '../api';
import type { WidgetConfigPanelProps } from '../types';
import { AdvancedEditor } from './advanced-editor';
import { AskQuestionWizard } from './ask-question-wizard';
import { ModeFlipConfirmDialog } from './mode-flip-confirm';

export function WidgetConfigPanel(props: WidgetConfigPanelProps) {
  // Keying on widget.id forces a remount when the selected widget changes,
  // so the inline-edit title stays in sync without setState-in-effect.
  return <WidgetConfigPanelInner key={props.widget.id} {...props} />;
}

function WidgetConfigPanelInner({ dashboardId, widget, onSave, onClose }: WidgetConfigPanelProps) {
  const canWrite = usePermission('dashboard:write');
  const [title, setTitle] = useState(widget.title);
  const [flipOpen, setFlipOpen] = useState(false);
  const [flipping, setFlipping] = useState(false);

  const definition = BUILT_IN_WIDGETS[widget.kind];

  async function commitTitle() {
    const next = title.trim();
    if (next === '' || next === widget.title) {
      setTitle(widget.title);
      return;
    }
    try {
      const saved = await updateWidget(widget.id, { title: next });
      onSave(saved);
    } catch (e) {
      notify.error('Rename failed', (e as Error).message);
      setTitle(widget.title);
    }
  }

  async function handleFlipToAdvanced() {
    setFlipping(true);
    try {
      const flipped = await flipWidgetToAdvanced(widget.id);
      notify.success(
        'Flipped to advanced',
        'The wizard view is disabled — edit the raw query in the advanced editor.',
      );
      onSave(flipped);
      setFlipOpen(false);
    } catch (e) {
      notify.error('Flip failed', (e as Error).message);
    } finally {
      setFlipping(false);
    }
  }

  return (
    <Stack gap="sm" p="sm" aria-label="Widget configuration panel">
      <Group justify="space-between" align="center">
        <TextInput
          variant="unstyled"
          size="md"
          value={title}
          onChange={(e) => {
            setTitle(e.currentTarget.value);
          }}
          onBlur={() => {
            void commitTitle();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget).blur();
            }
          }}
          aria-label="Widget title"
          data-testid="panel-title-input"
          styles={{
            input: {
              fontWeight: 600,
              fontSize: 'var(--mantine-font-size-md)',
            },
          }}
        />
        <ActionIcon variant="subtle" aria-label="Close widget config" onClick={onClose}>
          <IconX size={16} />
        </ActionIcon>
      </Group>
      <Divider />

      {widget.locked_advanced ? (
        <AdvancedEditor widget={widget} onSave={onSave} />
      ) : (
        <>
          <AskQuestionWizard
            dashboardId={dashboardId}
            widget={widget}
            mode="edit"
            onSave={(w) => {
              onSave(w);
            }}
            onCancel={onClose}
          />
          <Divider />
          <Group justify="flex-end">
            <Tooltip
              label={
                definition?.roundTripMode === 'one-way'
                  ? 'One-way: you will no longer be able to use the wizard for this widget.'
                  : 'Flip this widget to the raw query editor.'
              }
              withArrow
              multiline
              w={260}
            >
              <Button
                variant="default"
                size="xs"
                color="violet"
                leftSection={<IconCode size={14} />}
                disabled={!canWrite}
                onClick={() => {
                  setFlipOpen(true);
                }}
                data-testid="widget-flip-to-advanced"
              >
                Flip to advanced…
              </Button>
            </Tooltip>
          </Group>
        </>
      )}
      <ModeFlipConfirmDialog
        variant="widget"
        opened={flipOpen}
        onCancel={() => {
          setFlipOpen(false);
        }}
        onConfirm={() => {
          void handleFlipToAdvanced();
        }}
        widget={widget}
        widgetDisplayName={definition?.displayName ?? widget.kind}
        busy={flipping}
      />
    </Stack>
  );
}
