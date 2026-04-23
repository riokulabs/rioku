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
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
  useMatches,
  ActionIcon,
  type TitleOrder,
} from '@mantine/core';
import {
  IconDownload,
  IconHistory,
  IconHome,
  IconLayoutDashboard,
  IconPencil,
  IconStar,
  IconCopy,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { EmptyState } from '@/components/empty-state';
import { WidgetRenderer } from '@/components/widget-renderer';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import {
  DashboardRangeProvider,
  TIME_RANGES,
  useDashboardRange,
  type TimeRangeId,
} from '@/hooks/use-dashboard-range';
import { useWidgetData } from '@/features/dashboard-builder';
import type { Widget } from '@/api/resources/types';
import { useDashboardDetail, useDashboardWidgets, setAsMyHome } from '../api';
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

export function DashboardViewer(props: DashboardViewerProps) {
  return (
    <DashboardRangeProvider>
      <DashboardViewerInner {...props} />
    </DashboardRangeProvider>
  );
}

function DashboardViewerInner({
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
  // On mobile, collapse action buttons to icon-only to save horizontal space.
  const isMobile = useMatches({ base: true, sm: false });
  // Title shrinks one step on mobile to avoid wrapping with badge beside it.
  const titleOrder = useMatches({ base: 3, sm: 2 }) as TitleOrder;

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

  const absoluteUpdated = dayjs(dashboard.updated_at).format('YYYY-MM-DD HH:mm:ss');

  return (
    <Stack gap="md" p="md">
      {/* Header */}
      <Stack gap={4}>
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
            <Group gap="sm" align="center" wrap="wrap">
              <Title order={titleOrder}>{dashboard.name}</Title>
              <Badge
                size="sm"
                variant="light"
                color={dashboard.mode === 'metabase' ? 'blue' : 'violet'}
              >
                {dashboard.mode}
              </Badge>
              {dashboard.default && (
                <Badge size="sm" variant="light" color="green" leftSection={<IconStar size={10} />}>
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

          {/* Action buttons — full labels on ≥sm, icon-only on mobile */}
          <Group gap="xs" wrap="wrap" style={{ flexShrink: 0 }}>
            {canWrite &&
              onEdit &&
              (isMobile ? (
                <Tooltip label="Edit" withArrow>
                  <ActionIcon
                    variant="default"
                    size="lg"
                    aria-label="Edit dashboard"
                    onClick={() => {
                      onEdit(dashboard.id);
                    }}
                  >
                    <IconPencil size={16} />
                  </ActionIcon>
                </Tooltip>
              ) : (
                <Button
                  variant="default"
                  leftSection={<IconPencil size={14} />}
                  onClick={() => {
                    onEdit(dashboard.id);
                  }}
                >
                  Edit
                </Button>
              ))}
            {canWrite &&
              onClone &&
              (isMobile ? (
                <Tooltip label="Clone" withArrow>
                  <ActionIcon
                    variant="default"
                    size="lg"
                    aria-label="Clone dashboard"
                    onClick={() => {
                      onClone(dashboard.id);
                    }}
                  >
                    <IconCopy size={16} />
                  </ActionIcon>
                </Tooltip>
              ) : (
                <Button
                  variant="default"
                  onClick={() => {
                    onClone(dashboard.id);
                  }}
                >
                  Clone
                </Button>
              ))}
            {isMobile ? (
              <Tooltip label="Export JSON" withArrow>
                <ActionIcon
                  variant="default"
                  size="lg"
                  aria-label="Export JSON"
                  onClick={handleExport}
                >
                  <IconDownload size={16} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <Button
                variant="default"
                leftSection={<IconDownload size={14} />}
                onClick={handleExport}
              >
                Export JSON
              </Button>
            )}
            {isMobile ? (
              <Tooltip label="Set as home" withArrow>
                <ActionIcon
                  variant="default"
                  size="lg"
                  aria-label="Set as home dashboard"
                  disabled={currentUserId === null}
                  onClick={() => {
                    void handleMakeMyHome();
                  }}
                >
                  <IconHome size={16} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <Button
                variant="default"
                leftSection={<IconHome size={14} />}
                disabled={currentUserId === null}
                onClick={() => {
                  void handleMakeMyHome();
                }}
              >
                Make this my home
              </Button>
            )}
            {onVersionHistory &&
              (isMobile ? (
                <Tooltip label="Version history" withArrow>
                  <ActionIcon
                    variant="default"
                    size="lg"
                    aria-label="Version history"
                    onClick={() => {
                      onVersionHistory(dashboard.id);
                    }}
                  >
                    <IconHistory size={16} />
                  </ActionIcon>
                </Tooltip>
              ) : (
                <Button
                  variant="default"
                  leftSection={<IconHistory size={14} />}
                  onClick={() => {
                    onVersionHistory(dashboard.id);
                  }}
                >
                  Version history
                </Button>
              ))}
          </Group>
        </Group>
      </Stack>

      {/* Time range selector — lives at dashboard scope; injected into
         * useWidgetData via context so every widget re-queries when the
         * user flips it. The active range ID is shown in muted text to
         * echo the selection in human-readable terms. */}
      <TimeRangeBar />

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
                  onClick: () => {
                    onEdit(dashboard.id);
                  },
                },
              }
            : {})}
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${String(effectiveColumns)}, 1fr)`,
            // On mobile single-column, use auto rows so chart cards expand to
            // fit their content instead of being clipped to 80px row height.
            gridAutoRows: effectiveColumns === 1 ? 'auto' : `${String(ROW_HEIGHT_PX)}px`,
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

/**
 * Dashboard-scope time-range segmented control. Posts to the shared
 * `DashboardRangeProvider` so every widget re-queries when the user
 * clicks a new range. Rendered above the widget grid.
 */
function TimeRangeBar() {
  const { range, setRangeId } = useDashboardRange();
  return (
    <Group justify="flex-end" gap="sm" wrap="wrap">
      <Text size="xs" c="dimmed">
        Showing {range.longLabel}
      </Text>
      <SegmentedControl
        size="xs"
        value={range.id}
        onChange={(v) => {
          setRangeId(v as TimeRangeId);
        }}
        data={TIME_RANGES.map((r) => ({ label: r.label, value: r.id }))}
        aria-label="Dashboard time range"
      />
    </Group>
  );
}

/**
 * Per-kind accent colour for the title rail + header dot. Keyed to the
 * widget's role on the page: traffic metrics = info, health = success,
 * errors = danger, AI = primary orange. Any unknown kind falls back to
 * the primary palette.
 */
const WIDGET_ACCENT: Record<string, string> = {
  'kpi-card': 'riokuOrange',
  'single-stat': 'riokuOrange',
  sparkline: 'riokuInfo',
  'time-series': 'riokuInfo',
  'area-chart': 'riokuInfo',
  'stacked-bar': 'riokuInfo',
  pie: 'riokuOrange',
  'top-n': 'riokuWarning',
  table: 'riokuSuccess',
  'service-map': 'riokuInfo',
  'log-viewer': 'riokuSuccess',
  'audit-tail': 'riokuSuccess',
  gauge: 'riokuSuccess',
  heatmap: 'riokuOrange',
  'status-grid': 'riokuSuccess',
};

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

  // Prefer an explicit accent from widget.config, then the kind-based default,
  // then the primary palette. Surfaced as the title-row dot and (implicitly)
  // the KPI-card / area-chart stroke colors when no override is configured.
  const configAccent =
    typeof widget.config['accent'] === 'string' ? (widget.config['accent'] as string) : undefined;
  const accent = configAccent ?? WIDGET_ACCENT[widget.kind] ?? 'riokuOrange';
  const accentVar = `var(--mantine-color-${accent}-6)`;

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
        height: effectiveCols === 1 ? 'auto' : '100%',
        backgroundColor: 'var(--mantine-color-default)',
        borderColor: 'var(--mantine-color-default-border)',
        position: 'relative',
      }}
      role="listitem"
      aria-label={widget.title}
    >
      <Stack gap={10} style={{ height: effectiveCols === 1 ? 'auto' : '100%' }}>
        <Group gap={8} wrap="nowrap" align="center">
          <div
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: accentVar,
              boxShadow: `0 0 6px ${accentVar}`,
              flexShrink: 0,
            }}
          />
          <Text
            size="xs"
            fw={600}
            tt="uppercase"
            style={{ letterSpacing: '0.04em', color: 'var(--mantine-color-dimmed)' }}
            truncate
          >
            {widget.title}
          </Text>
        </Group>
        <div style={{ flex: effectiveCols === 1 ? undefined : 1, minHeight: 0 }}>
          <WidgetRenderer {...rendererProps} />
        </div>
      </Stack>
    </Card>
  );
}
