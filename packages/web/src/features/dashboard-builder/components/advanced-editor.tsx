/**
 * <AdvancedEditor> — raw-query editor for widgets in advanced mode.
 *
 * Replaces the placeholder alert inside <WidgetConfigPanel> when a widget
 * is `locked_advanced` or the dashboard is in Grafana mode. Ships with:
 *
 *  - Monaco editor lazy-loaded via React.lazy / Suspense. Falls back to a
 *    readonly Textarea while the chunk is in flight.
 *  - Language map: built-in data sources use `json` (stage-1 mock query
 *    syntax is JSON). Unknown / plugin data sources fall back to `text`.
 *  - Preview button that re-runs the query via `useWidgetData` and shows
 *    the result in a read-only `<WidgetRenderer>`.
 *  - Flip-to-wizard button, visible only when the widget's kind has
 *    `roundTripMode === 'clean'` AND the widget is not locked. Calls
 *    `flipWidgetToWizard` and bubbles errors via `notify.error`.
 *
 * Permission: advanced edit requires `dashboard:write`. The Save button is
 * disabled (+ a hint is shown) when the caller lacks the perm.
 */
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  Group,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconDeviceFloppy,
  IconPlayerPlay,
} from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { WidgetRenderer } from '@/components/widget-renderer';
import { BUILT_IN_WIDGETS } from '@/features/widgets/registry';
import type { Widget } from '@/api/resources/types';
import { flipWidgetToWizard, updateWidget, useWidgetData } from '../api';

// ─── Monaco (lazy) ────────────────────────────────────────────────────────────

interface MonacoEditorProps {
  value: string;
  language: string;
  onChange: (v: string | undefined) => void;
  height?: number;
  readOnly?: boolean;
}

/**
 * Lazy Monaco wrapper — isolates the heavy dep behind a dynamic import so it
 * ships in its own async chunk and is only fetched when the advanced editor
 * actually renders.
 */
const LazyMonaco = lazy(async () => {
  const mod = await import('@monaco-editor/react');
  const Editor = mod.default;
  return {
    default: ({
      value,
      language,
      onChange,
      height = 220,
      readOnly = false,
    }: MonacoEditorProps) => (
      <Editor
        value={value}
        language={language}
        onChange={onChange}
        height={height}
        theme="vs-dark"
        options={{
          readOnly,
          minimap: { enabled: false },
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          fontSize: 13,
          tabSize: 2,
          automaticLayout: true,
        }}
      />
    ),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KNOWN_DATA_SOURCES = new Set([
  'audit',
  'services',
  'routes',
  'traces',
  'notifications',
  'mock',
]);

function editorLanguage(dataSource: string): string {
  return KNOWN_DATA_SOURCES.has(dataSource) ? 'json' : 'text';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AdvancedEditorProps {
  widget: Widget;
  onSave: (widget: Widget) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdvancedEditor({ widget, onSave }: AdvancedEditorProps) {
  const canWrite = usePermission('dashboard:write');
  const [draft, setDraft] = useState(widget.raw_query);
  const [saving, setSaving] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(false);

  const language = useMemo(
    () => editorLanguage(widget.data_source),
    [widget.data_source],
  );

  // Preview uses a cloned widget with the currently-edited draft so the user
  // sees their WIP query, not the last-saved one.
  const previewWidget: Widget = useMemo(
    () => ({ ...widget, raw_query: draft }),
    [widget, draft],
  );
  const previewData = useWidgetData(previewEnabled ? previewWidget : undefined);

  const definition = BUILT_IN_WIDGETS[widget.kind];
  const canFlipToWizard =
    definition?.roundTripMode === 'clean' && !widget.locked_advanced;

  const dirty = draft !== widget.raw_query;

  const handleSave = useCallback(async () => {
    if (!canWrite) {
      notify.error(
        'Permission denied',
        'You need dashboard:write to edit the advanced query.',
      );
      return;
    }
    setSaving(true);
    try {
      const saved = await updateWidget(widget.id, { raw_query: draft });
      notify.success('Query saved', 'The widget query was updated.');
      onSave(saved);
    } catch (e) {
      notify.error('Save failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [canWrite, widget.id, draft, onSave]);

  const handleFlipToWizard = useCallback(async () => {
    if (!canWrite) {
      notify.error(
        'Permission denied',
        'You need dashboard:write to flip this widget.',
      );
      return;
    }
    if (widget.locked_advanced) {
      notify.error(
        'Cannot flip',
        'This widget is locked to advanced mode and cannot return to the wizard.',
      );
      return;
    }
    setFlipping(true);
    try {
      const flipped = await flipWidgetToWizard(widget.id);
      notify.success(
        'Switched to wizard',
        'The advanced query was cleared; edit dimensions & measures in the wizard.',
      );
      onSave(flipped);
    } catch (e) {
      notify.error('Flip failed', (e as Error).message);
    } finally {
      setFlipping(false);
    }
  }, [canWrite, widget.id, widget.locked_advanced, onSave]);

  const handleRunPreview = useCallback(() => {
    setPreviewEnabled(true);
  }, []);

  return (
    <Stack gap="sm" data-testid="advanced-editor">
      <Alert
        color={widget.locked_advanced ? 'violet' : 'blue'}
        variant="light"
        icon={<IconAlertCircle size={16} />}
        title={widget.locked_advanced ? 'Advanced mode (locked)' : 'Advanced mode'}
      >
        <Text size="sm">
          {widget.locked_advanced
            ? `This widget type ("${definition?.displayName ?? widget.kind}") is a one-way flip. The wizard view is disabled — edit the raw query here.`
            : 'Edit the raw query below. Use the Preview button to run it against the current data.'}
        </Text>
      </Alert>

      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="sm" fw={500}>
            Raw query ({language})
          </Text>
          {dirty && (
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Unsaved changes
            </Text>
          )}
        </Group>
        <Box
          style={{
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 'var(--mantine-radius-sm)',
            overflow: 'hidden',
          }}
          data-testid="advanced-editor-host"
        >
          <Suspense
            fallback={
              <Textarea
                value={draft}
                readOnly
                rows={8}
                data-testid="advanced-editor-fallback"
                aria-label="Advanced query (loading editor)"
              />
            }
          >
            <LazyMonaco
              value={draft}
              language={language}
              onChange={(v) => {
                setDraft(v ?? '');
              }}
              readOnly={!canWrite}
            />
          </Suspense>
        </Box>
        {!canWrite && (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Read-only — you need dashboard:write to edit.
          </Text>
        )}
      </Stack>

      <Group gap="xs">
        <Button
          size="xs"
          leftSection={<IconDeviceFloppy size={14} />}
          loading={saving}
          disabled={!canWrite || !dirty}
          onClick={() => {
            void handleSave();
          }}
          data-testid="advanced-editor-save"
        >
          Save query
        </Button>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconPlayerPlay size={14} />}
          onClick={handleRunPreview}
          data-testid="advanced-editor-preview"
        >
          Preview
        </Button>
        {canFlipToWizard && (
          <Tooltip
            label="Clears the raw query and returns the widget to wizard mode."
            withArrow
          >
            <Button
              size="xs"
              variant="default"
              color="grape"
              leftSection={<IconArrowBackUp size={14} />}
              loading={flipping}
              disabled={!canWrite}
              onClick={() => {
                void handleFlipToWizard();
              }}
              data-testid="advanced-editor-flip-to-wizard"
            >
              Flip to wizard
            </Button>
          </Tooltip>
        )}
      </Group>

      {previewEnabled && (
        <>
          <Divider label="Preview" labelPosition="left" />
          <Box
            style={{
              minHeight: 180,
              border: '1px solid var(--mantine-color-default-border)',
              borderRadius: 'var(--mantine-radius-sm)',
              padding: 'var(--mantine-spacing-sm)',
              background: 'var(--mantine-color-body)',
            }}
            data-testid="advanced-editor-preview-pane"
          >
            <WidgetRenderer
              widget={previewWidget}
              data={previewData.data}
              loading={previewData.loading}
              {...(previewData.error !== undefined
                ? { error: previewData.error }
                : {})}
            />
          </Box>
        </>
      )}
    </Stack>
  );
}
