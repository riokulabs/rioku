/**
 * <DashboardBuilderShell> — full-page layout that glues together the palette,
 * grid canvas, and widget config side panel.
 *
 * Layout (CSS grid):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Top bar: name inline-edit · mode toggle · Save · Cancel ·    │
 *   │          Version history                                     │
 *   ├──────────┬──────────────────────────────────┬────────────────┤
 *   │ Palette  │ <GridCanvas>                     │ Config panel   │
 *   │ (240px)  │                                  │ (320px, when   │
 *   │          │                                  │  a widget is   │
 *   │          │                                  │  selected)     │
 *   └──────────┴──────────────────────────────────┴────────────────┘
 *
 * This shell also owns:
 *  - Dirty-state detection (compares current widgets/layout to initial).
 *  - The Save flow (Task 4c.18) — snapshot + update + success toast +
 *    navigate back to viewer.
 *  - The Cancel flow — confirm modal when dirty.
 */
import {
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from 'react';
import {
  Alert,
  Box,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconDeviceFloppy,
  IconHistory,
  IconX,
} from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import {
  snapshotDashboard,
  updateDashboard,
  useDashboardDetail,
  useDashboardWidgets,
} from '@/features/dashboards';
import type { Dashboard, Widget } from '@/api/resources/types';
import {
  addWidget,
  removeWidget,
  updateLayout,
} from '../api';
import { GridCanvas } from './grid-canvas';
import { WidgetPalette } from './widget-palette';
import { WidgetConfigPanel } from './widget-config-panel';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DashboardBuilderShellProps {
  dashboardId: string;
  onDone: (outcome: 'saved' | 'cancelled') => void;
  onVersionHistory?: (dashboardId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface DashboardSnapshot {
  name: string;
  description: string;
  mode: Dashboard['mode'];
  layout: string;
  widgetIds: string;
  widgetSigs: string;
}

function snapshotOf(
  dashboard: Dashboard | undefined,
  widgets: Widget[],
): DashboardSnapshot {
  if (!dashboard) {
    return {
      name: '',
      description: '',
      mode: 'metabase',
      layout: '{}',
      widgetIds: '[]',
      widgetSigs: '[]',
    };
  }
  // Sort layout keys for a stable serialization.
  const layoutKeys = Object.keys(dashboard.layout).sort();
  const layoutStable: Record<string, Dashboard['layout'][string]> = {};
  for (const k of layoutKeys) {
    const v = dashboard.layout[k];
    if (v) layoutStable[k] = v;
  }
  return {
    name: dashboard.name,
    description: dashboard.description ?? '',
    mode: dashboard.mode,
    layout: JSON.stringify(layoutStable),
    widgetIds: JSON.stringify(dashboard.widget_ids),
    widgetSigs: JSON.stringify(
      widgets.map((w) => ({
        id: w.id,
        kind: w.kind,
        title: w.title,
        data_source: w.data_source,
        locked_advanced: w.locked_advanced,
        raw_query: w.raw_query,
        wizard_state: w.wizard_state,
      })),
    ),
  };
}

function snapshotsEqual(a: DashboardSnapshot, b: DashboardSnapshot): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.mode === b.mode &&
    a.layout === b.layout &&
    a.widgetIds === b.widgetIds &&
    a.widgetSigs === b.widgetSigs
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DashboardBuilderShell(props: DashboardBuilderShellProps) {
  // Gate the inner shell on the dashboard being present. Keying on
  // `dashboardId` also ensures a clean remount when the user navigates
  // between dashboards in the same session.
  return <DashboardBuilderShellGate key={props.dashboardId} {...props} />;
}

function DashboardBuilderShellGate({
  dashboardId,
  onDone,
  onVersionHistory,
}: DashboardBuilderShellProps) {
  const dashboard = useDashboardDetail(dashboardId);
  const widgets = useDashboardWidgets(dashboardId);

  if (!dashboard) {
    return (
      <Stack gap="md" p="md">
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
          Dashboard not found.
        </Alert>
      </Stack>
    );
  }
  return (
    <ShellInner
      dashboard={dashboard}
      widgets={widgets}
      onDone={onDone}
      {...(onVersionHistory !== undefined ? { onVersionHistory } : {})}
    />
  );
}

interface ShellInnerProps {
  dashboard: Dashboard;
  widgets: Widget[];
  onDone: (outcome: 'saved' | 'cancelled') => void;
  onVersionHistory?: (dashboardId: string) => void;
}

function ShellInner({
  dashboard,
  widgets,
  onDone,
  onVersionHistory,
}: ShellInnerProps) {
  // Baseline captured via lazy initializer — runs exactly once when this
  // component mounts (after the gate confirmed `dashboard` exists).
  const [baseline, setBaseline] = useState<DashboardSnapshot>(() =>
    snapshotOf(dashboard, widgets),
  );
  const [name, setName] = useState(dashboard.name);
  const [description, setDescription] = useState(dashboard.description ?? '');
  const [mode, setMode] = useState<Dashboard['mode']>(dashboard.mode);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const selectedWidget = useMemo(() => {
    if (selectedWidgetId === null) return null;
    return widgets.find((w) => w.id === selectedWidgetId) ?? null;
  }, [widgets, selectedWidgetId]);

  // Current snapshot — recomputed whenever dashboard / widgets / local state change.
  const currentSnapshot: DashboardSnapshot = useMemo(() => {
    const synthetic: Dashboard = {
      ...dashboard,
      name,
      ...(description !== '' ? { description } : {}),
      mode,
    };
    return snapshotOf(synthetic, widgets);
  }, [dashboard, widgets, name, description, mode]);

  const dirty = useMemo(
    () => !snapshotsEqual(baseline, currentSnapshot),
    [baseline, currentSnapshot],
  );

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleSelectWidget = useCallback((widgetId: string | null) => {
    setSelectedWidgetId(widgetId);
  }, []);

  const handleAddWidget = useCallback(
    async (kind: string, position: { x: number; y: number }) => {
      try {
        const placement = {
          x: Math.max(0, Math.min(12 - 4, position.x)),
          y: Math.max(0, position.y),
          w: 4,
          h: 3,
        };
        const created = await addWidget(dashboard.id, {
          kind,
          title: 'Untitled widget',
          data_source: 'mock',
          position: placement,
        });
        setSelectedWidgetId(created.id);
        notify.success('Widget added', created.title);
      } catch (e) {
        notify.error('Add widget failed', (e as Error).message);
      }
    },
    [dashboard],
  );

  const handleMoveWidget = useCallback(
    async (widgetId: string, x: number, y: number) => {
      const existing = dashboard.layout[widgetId];
      if (!existing) return;
      const nextLayout = { ...dashboard.layout, [widgetId]: { ...existing, x, y } };
      try {
        await updateLayout(dashboard.id, nextLayout);
      } catch (e) {
        notify.error('Move failed', (e as Error).message);
      }
    },
    [dashboard],
  );

  const handleResizeWidget = useCallback(
    async (widgetId: string, w: number, h: number) => {
      const existing = dashboard.layout[widgetId];
      if (!existing) return;
      const nextLayout = { ...dashboard.layout, [widgetId]: { ...existing, w, h } };
      try {
        await updateLayout(dashboard.id, nextLayout);
      } catch (e) {
        notify.error('Resize failed', (e as Error).message);
      }
    },
    [dashboard],
  );

  const handleRemoveWidget = useCallback(
    async (widgetId: string) => {
      try {
        await removeWidget(dashboard.id, widgetId);
        if (selectedWidgetId === widgetId) setSelectedWidgetId(null);
      } catch (e) {
        notify.error('Remove failed', (e as Error).message);
      }
    },
    [dashboard, selectedWidgetId],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await snapshotDashboard(dashboard.id, 'Saved from builder');
      await updateDashboard(dashboard.id, {
        name: name.trim() === '' ? dashboard.name : name.trim(),
        ...(description.trim() !== '' ? { description: description.trim() } : {}),
        mode,
      });
      notify.success('Dashboard saved', 'A new version was snapshotted.');
      setBaseline(
        snapshotOf(
          {
            ...dashboard,
            name,
            ...(description !== '' ? { description } : {}),
            mode,
          },
          widgets,
        ),
      );
      onDone('saved');
    } catch (e) {
      notify.error('Save failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [dashboard, name, description, mode, widgets, onDone]);

  const handleCancel = useCallback(() => {
    if (dirty) {
      setCancelOpen(true);
      return;
    }
    onDone('cancelled');
  }, [dirty, onDone]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const showConfigPanel = selectedWidget !== null;

  return (
    <Stack gap={0} h="100%" data-testid="dashboard-builder-shell">
      {/* Top bar */}
      <Group
        justify="space-between"
        align="center"
        p="sm"
        wrap="nowrap"
        style={{
          borderBottom: '1px solid var(--mantine-color-gray-3)',
          background: 'var(--mantine-color-body)',
        }}
      >
        <Group gap="sm" style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
          <Title order={4} style={{ whiteSpace: 'nowrap' }}>
            Builder
          </Title>
          <TextInput
            variant="unstyled"
            aria-label="Dashboard name"
            value={name}
            onChange={(e) => {
              setName(e.currentTarget.value);
            }}
            placeholder="Untitled dashboard"
            styles={{
              input: {
                fontWeight: 600,
                fontSize: 'var(--mantine-font-size-lg)',
                minWidth: 240,
              },
            }}
            data-testid="builder-name-input"
          />
          <TextInput
            variant="unstyled"
            aria-label="Dashboard description"
            value={description}
            onChange={(e) => {
              setDescription(e.currentTarget.value);
            }}
            placeholder="Add a description"
            styles={{ input: { fontSize: 'var(--mantine-font-size-sm)' } }}
            style={{ flex: 1, minWidth: 120 }}
          />
        </Group>

        <Group gap="xs" wrap="nowrap">
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(v) => {
              setMode(v === 'grafana' ? 'grafana' : 'metabase');
            }}
            data={[
              { value: 'metabase', label: 'Metabase' },
              { value: 'grafana', label: 'Grafana' },
            ]}
            aria-label="Dashboard mode"
          />
          {onVersionHistory && (
            <Button
              variant="default"
              size="xs"
              leftSection={<IconHistory size={14} />}
              onClick={() => {
                onVersionHistory(dashboard.id);
              }}
            >
              History
            </Button>
          )}
          <Button
            variant="default"
            size="xs"
            leftSection={<IconX size={14} />}
            onClick={handleCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="xs"
            leftSection={<IconDeviceFloppy size={14} />}
            loading={saving}
            onClick={() => {
              void handleSave();
            }}
            data-testid="builder-save"
          >
            Save
          </Button>
        </Group>
      </Group>

      {/* Main */}
      <Box
        style={{
          display: 'grid',
          gridTemplateColumns: showConfigPanel
            ? '240px 1fr 340px'
            : '240px 1fr',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <PanelColumn
          title="Widget palette"
          style={{
            borderRight: '1px solid var(--mantine-color-gray-3)',
            overflowY: 'auto',
          }}
        >
          <WidgetPalette dashboard={dashboard} />
        </PanelColumn>

        <Box
          style={{
            overflow: 'auto',
            padding: 'var(--mantine-spacing-md)',
            background: 'var(--mantine-color-gray-0)',
            minWidth: 0,
          }}
        >
          <GridCanvas
            dashboard={dashboard}
            widgets={widgets}
            selectedWidgetId={selectedWidgetId}
            onSelect={handleSelectWidget}
            onAddWidget={(kind, pos) => {
              void handleAddWidget(kind, pos);
            }}
            onMoveWidget={(id, x, y) => {
              void handleMoveWidget(id, x, y);
            }}
            onResizeWidget={(id, w, h) => {
              void handleResizeWidget(id, w, h);
            }}
            onRemoveWidget={(id) => {
              void handleRemoveWidget(id);
            }}
          />
        </Box>

        {showConfigPanel && (
          <PanelColumn
            title="Widget configuration"
            style={{
              borderLeft: '1px solid var(--mantine-color-gray-3)',
              overflowY: 'auto',
            }}
          >
            <WidgetConfigPanel
              dashboardId={dashboard.id}
              widget={selectedWidget}
              onSave={() => {
                // Latest widget values are already in the zustand store — no
                // local-state bump needed.
              }}
              onClose={() => {
                setSelectedWidgetId(null);
              }}
            />
          </PanelColumn>
        )}
      </Box>

      <Modal
        opened={cancelOpen}
        onClose={() => {
          setCancelOpen(false);
        }}
        title="Discard changes?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            You have unsaved changes to this dashboard. Leaving now will lose
            them.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setCancelOpen(false);
              }}
            >
              Keep editing
            </Button>
            <Button
              color="red"
              onClick={() => {
                setCancelOpen(false);
                onDone('cancelled');
              }}
            >
              Discard
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

// ─── Local layout helper ──────────────────────────────────────────────────────

interface PanelColumnProps {
  title: string;
  style?: React.CSSProperties;
  children: ReactNode;
}

function PanelColumn({ title, style, children }: PanelColumnProps) {
  return (
    <Box
      aria-label={title}
      style={{
        minHeight: 0,
        background: 'var(--mantine-color-body)',
        ...style,
      }}
    >
      {children}
    </Box>
  );
}
