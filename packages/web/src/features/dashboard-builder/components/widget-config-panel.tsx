/**
 * <WidgetConfigPanel> — right-sidebar editor for the currently-selected widget.
 *
 * Behaviour matches Plan 4 §4c.17:
 *
 *  - Header shows an inline-edit `<TextInput variant="unstyled">` for the
 *    widget title; commits the rename on blur / Enter.
 *  - If the widget is locked to advanced mode → renders
 *    `<AdvancedPlaceholder>` pointing at Phase 4d's Monaco editor.
 *  - Else → renders `<AskQuestionWizard mode="edit" …>` inline, scoped to
 *    the current widget.
 *  - Close button collapses the panel.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Group,
  Stack,
  Text,
  TextInput,
  ActionIcon,
} from '@mantine/core';
import { IconCode, IconX } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { updateWidget } from '../api';
import type { WidgetConfigPanelProps } from '../types';
import { AskQuestionWizard } from './ask-question-wizard';

export function WidgetConfigPanel(props: WidgetConfigPanelProps) {
  // Keying on widget.id forces a remount when the selected widget changes,
  // so the inline-edit title stays in sync without setState-in-effect.
  return <WidgetConfigPanelInner key={props.widget.id} {...props} />;
}

function WidgetConfigPanelInner({
  dashboardId,
  widget,
  onSave,
  onClose,
}: WidgetConfigPanelProps) {
  const [title, setTitle] = useState(widget.title);

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
              (e.currentTarget as HTMLInputElement).blur();
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
        <ActionIcon
          variant="subtle"
          aria-label="Close widget config"
          onClick={onClose}
        >
          <IconX size={16} />
        </ActionIcon>
      </Group>
      <Divider />

      {widget.locked_advanced ? (
        <AdvancedPlaceholder />
      ) : (
        <AskQuestionWizard
          dashboardId={dashboardId}
          widget={widget}
          mode="edit"
          onSave={(w) => {
            onSave(w);
          }}
          onCancel={onClose}
        />
      )}
    </Stack>
  );
}

function AdvancedPlaceholder() {
  return (
    <Alert
      color="violet"
      variant="light"
      icon={<IconCode size={16} />}
      title="Advanced mode"
    >
      <Stack gap="xs">
        <Text size="sm">
          This widget was flipped to advanced mode — its raw query can only be
          edited in the Advanced editor (ships in Phase 4d).
        </Text>
        <Group>
          <Button
            variant="default"
            size="xs"
            disabled
            data-testid="advanced-editor-open"
          >
            Edit in Advanced mode
          </Button>
        </Group>
      </Stack>
    </Alert>
  );
}
