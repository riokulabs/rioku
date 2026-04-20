/**
 * <ModeFlipConfirmDialog> — two-path confirm used by the builder shell.
 *
 *  1. Dashboard-level flip (Metabase → Grafana): enumerates every widget
 *     whose kind has `roundTripMode === 'one-way'` so the user can see
 *     exactly which widgets will become locked to advanced mode.
 *
 *  2. Single-widget flip (inside AdvancedEditor / wizard → advanced): shows a
 *     short notice explaining the widget is a one-way flip.
 *
 * Confirm is gated on a "I understand" checkbox in the dashboard-level path
 * (matches the spec). The single-widget path is a simpler Confirm/Cancel.
 *
 * Ships as a pure component: callers own the mutation side-effects so the
 * dialog stays re-usable (builder shell, AdvancedEditor, viewer future use).
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  List,
  Modal,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { BUILT_IN_WIDGETS } from '@/features/widgets/registry';
import type { Widget } from '@/api/resources/types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ModeFlipConfirmDialogProps {
  /**
   * 'dashboard' = Metabase → Grafana flip on the whole dashboard. Enumerates
   *    one-way widgets.
   * 'widget'    = single widget wizard → advanced flip.
   */
  variant: 'dashboard' | 'widget';
  opened: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  /** Required when variant === 'dashboard'. All widgets on the dashboard. */
  widgets?: Widget[];
  /** Required when variant === 'widget'. */
  widget?: Widget;
  /** Shown in the title bar in the 'widget' variant. */
  widgetDisplayName?: string;
  /** Loading flag while the caller's confirm handler is in-flight. */
  busy?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ModeFlipConfirmDialog(props: ModeFlipConfirmDialogProps) {
  // Keying on `opened` resets internal state (ack checkbox) whenever the
  // modal (re)opens — no effect-driven setState.
  return (
    <ModeFlipConfirmDialogInner
      key={props.opened ? 'opened' : 'closed'}
      {...props}
    />
  );
}

function ModeFlipConfirmDialogInner(props: ModeFlipConfirmDialogProps) {
  const {
    variant,
    opened,
    onCancel,
    onConfirm,
    widgets = [],
    widget,
    widgetDisplayName,
    busy = false,
  } = props;

  const [understood, setUnderstood] = useState(false);

  if (variant === 'widget') {
    return (
      <Modal
        opened={opened}
        onClose={onCancel}
        title={
          widget !== undefined
            ? `Flip "${widgetDisplayName ?? widget.kind}" to advanced mode?`
            : 'Flip widget to advanced mode?'
        }
        centered
      >
        <Stack gap="md">
          <Alert
            color="orange"
            variant="light"
            icon={<IconAlertTriangle size={16} />}
          >
            <Text size="sm">
              This widget type is a one-way flip. After flipping you can no
              longer use the wizard for this widget — only the raw query
              editor.
            </Text>
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              color="violet"
              loading={busy}
              onClick={() => {
                void onConfirm();
              }}
              data-testid="mode-flip-confirm"
            >
              Flip to advanced
            </Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  // variant === 'dashboard'
  const affected = widgets.filter((w) => {
    const def = BUILT_IN_WIDGETS[w.kind];
    return def?.roundTripMode === 'one-way';
  });

  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title="Switch dashboard to Grafana mode?"
      centered
      size="lg"
    >
      <Stack gap="md">
        <Alert
          color="orange"
          variant="light"
          icon={<IconAlertTriangle size={16} />}
        >
          <Text size="sm">
            Grafana mode enables the raw query editor for every widget.{' '}
            {affected.length > 0
              ? 'The widgets listed below are one-way: after this flip, you can no longer use the wizard to edit them — only the raw query editor.'
              : 'None of the current widgets are one-way, so this flip is reversible per-widget.'}
          </Text>
        </Alert>

        {affected.length > 0 && (
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Widgets that will become one-way ({affected.length}):
            </Text>
            <List
              spacing={4}
              size="sm"
              data-testid="mode-flip-affected-list"
              styles={{ itemWrapper: { alignItems: 'center' } }}
            >
              {affected.map((w) => (
                <List.Item key={w.id}>
                  <Group gap="xs">
                    <Text size="sm" fw={500}>
                      {w.title}
                    </Text>
                    <Badge size="xs" variant="light" color="violet">
                      {w.kind}
                    </Badge>
                  </Group>
                </List.Item>
              ))}
            </List>
          </Stack>
        )}

        {affected.length > 0 && (
          <Checkbox
            label="I understand this is one-way for the widgets above"
            checked={understood}
            onChange={(e) => {
              setUnderstood(e.currentTarget.checked);
            }}
            data-testid="mode-flip-ack-checkbox"
          />
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            color="violet"
            loading={busy}
            disabled={affected.length > 0 && !understood}
            onClick={() => {
              void onConfirm();
            }}
            data-testid="mode-flip-confirm"
          >
            Switch to Grafana mode
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
