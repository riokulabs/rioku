/**
 * <DashboardViewer> — read-only grid view of a dashboard.
 *
 * Layout: 12-column CSS grid. Each widget is placed via the dashboard's
 * `layout[widgetId]` record (x, y, w, h). Width is clamped to 12 columns.
 *
 * Each cell renders <WidgetRenderer> driven by `useWidgetData(widget)` so
 * every widget has its own loading state and data is fetched in parallel.
 *
 * Header actions: Edit, Clone, Export JSON, Make this my home, Version
 * history. Sensitive actions respect dashboard:* permissions.
 */
import { useCallback } from 'react';
import {
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
  useMatches,
} from '@mantine/core';
import {
  IconDownload,
  IconHistory,
  IconHome,
  IconLayoutDashboard,
  IconPencil,
  IconStar,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { EmptyState } from '@/components/empty-state';
import { WidgetRenderer } from '@/components/widget-renderer';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useWidgetData } from '@/features/dashboard-builder';
import type { Widget } from '@/api/resources/types';
import {
  useDashboardDetail,
  useDashboardWidgets,
  setAsMyHome,
} from '../api';
import { downloadDashboardExport } from '../export-download';

dayjs.extend(relativeTime);

const GRID_COLUMNS = 12;
const ROW_HEIGHT_PX = 80;

interface DashboardViewerProps {
  dashboardId: string;
  /** Called when the user clicks Edit. Parent decides routing. */
  onEdit?: (dashboardId: string) => void;
  /** Called when the user clicks Clone. Parent decides behaviour. */
  onClone?: (dashboardId: string) => void;
  /** Called when the user opens Version history. */
  onVersionHistory?: (dashboardId: string) => void;
}

export function DashboardViewer({
  dashboardId,
  onEdit,
  onClone,
  onVersionHistory,
}: DashboardViewerProps) {
  const dashboard = useDashboardDetail(dashboardId);
  const widgets = useDashboardWidgets(dashboardId);
  const currentUserId = useMockStore((s) => s.currentUserId);
  const canWrite = usePermission('dashboard:write');
  // On mobile collapse the 12-col grid to a single column so widgets don't
  // render at sub-100px widths. Tablet gets 6 cols (half layout).
  const effectiveColumns = useMatches({ base: 1, sm: 6, md: GRID_COLUMNS });

  const handleExport = useCallback(() => {
    if (!dashboard) return;
    try {
      downloadDashboardExport(dashboard);
      notify.success('Dashboard exported', `${dashboard.name}.json downloaded.`);
    } catch (e) {
      notify.error('Export failed', (e as Error).message);
    }
  }, [dashboard]);

  const handleMakeMyHome = useCallback(async () => {
    if (!dashboard || !currentUserId) return;
    try {
      await setAsMyHome(currentUserId, dashboard.id);
      notify.success(
        'Home dashboard set',
        `${dashboard.name} will open when you visit the tenant dashboard.`,
      );
    } catch (e) {
      notify.error('Failed to set home', (e as Error).message);
    }
  }, [dashboard, currentUserId]);

  if (!dashboard) {
    return (
      <Stack gap="md" p="md">
        <EmptyState
          icon={IconLayoutDashboard}
          title="Dashboard not found"
          description="The dashboard you requested does not exist or has been deleted."
        />
      </Stack>
    );
  }

  const absoluteUpdated = dayjs(dashboard.updated_at).format(
    'YYYY-MM-DD HH:mm:ss',
  );

  return (
    <Stack gap="md" p="md">
      {/* Header */}
      <Stack gap={4}>
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
            <Group gap="sm" align="center">
              <Title order={2}>{dashboard.name}</Title>
              <Badge
                size="sm"
                variant="light"
                color={dashboard.mode === 'metabase' ? 'blue' : 'violet'}
              >
                {dashboard.mode}
              </Badge>
              {dashboard.default && (
                <Badge
                  size="sm"
                  variant="light"
                  color="green"
                  leftSection={<IconStar size={10} />}
                >
                  Default
                </Badge>
              )}
            </Group>
            {dashboard.description && (
              <Text size="sm" c="var(--mantine-color-gray-7)">
                {dashboard.description}
              </Text>
            )}
            <Tooltip label={absoluteUpdated} withArrow>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                Updated {dayjs(dashboard.updated_at).fromNow()}
              </Text>
            </Tooltip>
          </Stack>

          <Group gap="xs" wrap="wrap">
            {canWrite && onEdit && (
              <Button
                variant="default"
                leftSection={<IconPencil size={14} />}
                onClick={() => { onEdit(dashboard.id); }}
              >
                Edit
              </Button>
            )}
            {canWrite && onClone && (
              <Button
                variant="default"
                onClick={() => { onClone(dashboard.id); }}
              >
                Clone
              </Button>
            )}
            <Button
              variant="default"
              leftSection={<IconDownload size={14} />}
              onClick={handleExport}
            >
              Export JSON
            </Button>
            <Button
              variant="default"
              leftSection={<IconHome size={14} />}
              disabled={currentUserId === null}
              onClick={() => { void handleMakeMyHome(); }}
            >
              Make this my home
            </Button>
            {onVersionHistory && (
              <Button
                variant="default"
                leftSection={<IconHistory size={14} />}
                onClick={() => { onVersionHistory(dashboard.id); }}
              >
                Version history
              </Button>
            )}
          </Group>
        </Group>
      </Stack>

      {/* Grid */}
      {widgets.length === 0 ? (
        <EmptyState
          icon={IconLayoutDashboard}
          title="No widgets yet"
          description="Open the builder to add charts, tables, and stats."
          {...(canWrite && onEdit
            ? {
                action: {
                  label: 'Open builder',
                  onClick: () => { onEdit(dashboard.id); },
                },
              }
            : {})}
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${String(effectiveColumns)}, 1fr)`,
            gridAutoRows: `${String(ROW_HEIGHT_PX)}px`,
            gap: 'var(--mantine-spacing-md)',
          }}
          role="list"
          aria-label={`${dashboard.name} dashboard widgets`}
        >
          {widgets.map((widget) => (
            <WidgetCell
              key={widget.id}
              widget={widget}
              layout={dashboard.layout[widget.id]}
              effectiveCols={effectiveColumns}
            />
          ))}
        </div>
      )}
    </Stack>
  );
}

interface WidgetCellProps {
  widget: Widget;
  layout: { x: number; y: number; w: number; h: number } | undefined;
  /** The effective column count driving the grid (1 on mobile, 6 on tablet, 12 on desktop). */
  effectiveCols: number;
}

function WidgetCell({ widget, layout, effectiveCols }: WidgetCellProps) {
  const { data, loading, error } = useWidgetData(widget);

  // Fall back to widget.position if no layout record — matches the legacy
  // placement used in pre-Plan-4 seeds.
  const pos = layout ?? widget.position;

  // On mobile / reduced-column grid, clamp span and position to the effective
  // column count so CSS grid doesn't create implicit extra columns.
  const w = Math.max(1, Math.min(effectiveCols, pos.w));
  const h = Math.max(1, pos.h);
  // On single-column layout force all widgets to column 1 (ignore x).
  const col = effectiveCols === 1 ? 0 : Math.max(0, Math.min(effectiveCols - 1, pos.x));
  const row = effectiveCols === 1 ? 0 : Math.max(0, pos.y);

  const rendererProps = {
    widget,
    data,
    loading,
    ...(error !== undefined ? { error } : {}),
  };

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      style={{
        gridColumn: `${String(col + 1)} / span ${String(w)}`,
        gridRow: effectiveCols === 1 ? undefined : `${String(row + 1)} / span ${String(h)}`,
        overflow: 'hidden',
        minWidth: 0,
      }}
      role="listitem"
      aria-label={widget.title}
    >
      <Stack gap="xs" h="100%">
        <Text size="sm" fw={600}>
          {widget.title}
        </Text>
        <div style={{ flex: 1, minHeight: 0 }}>
          <WidgetRenderer {...rendererProps} />
        </div>
      </Stack>
    </Card>
  );
}
