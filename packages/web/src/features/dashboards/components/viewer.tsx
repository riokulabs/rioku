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
  IconDots,
  IconTrash,
  IconLock,
  IconShare,
  IconUsers,
  IconWorld,
} from '@tabler/icons-react';
import { Menu } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { EmptyState } from '@/components/empty-state';
import { WidgetRenderer } from '@/components/widget-renderer';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { DashboardRangeProvider, useDashboardRange } from '@/hooks/use-dashboard-range';
import { useWidgetData } from '@/features/dashboard-builder';
import type { Widget, DashboardRangeSpec } from '@/api/resources/types';
import { useDashboardDetail, useDashboardWidgets, setAsMyHome, updateDashboard } from '../api';
import { useDashboardAccess } from '../use-dashboard-access';
import { downloadDashboardExport } from '../export-download';
import { DashboardRangePicker } from './range-picker';
import { ShareDashboardModal } from './share-dashboard-modal';

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
  /** Called when the user requests deletion. Parent confirms and deletes. */
  onDelete?: (dashboardId: string) => void;
  /** Called when the user wants to set this dashboard as the tenant default. */
  onSetDefault?: (dashboardId: string) => void;
  /** Hide the "Make this my home" action — used on the landing route. */
  hideMakeHome?: boolean;
}

export function DashboardViewer(props: DashboardViewerProps) {
  // Read the dashboard's saved default_range so the provider seeds with it
  // instead of the global 24h fallback. We grab the dashboard here rather
  // than inside Inner because the provider needs the spec at mount time.
  const dashboard = useDashboardDetail(props.dashboardId);
  const initialSpec = dashboard?.default_range;
  return (
    <DashboardRangeProvider key={props.dashboardId} {...(initialSpec ? { initialSpec } : {})}>
      <DashboardViewerInner {...props} />
    </DashboardRangeProvider>
  );
}

function DashboardViewerInner({
  dashboardId,
  onEdit,
  onClone,
  onVersionHistory,
  onDelete,
  onSetDefault,
  hideMakeHome,
}: DashboardViewerProps) {
  const dashboard = useDashboardDetail(dashboardId);
  const widgets = useDashboardWidgets(dashboardId);
  const currentUserId = useMockStore((s) => s.currentUserId);
  // Effective per-dashboard access — combines tenant write perm + dashboard
  // owner/scope/grants. Edit/Delete buttons gate on this, not on the raw
  // tenant-level permission alone.
  const effectiveAccess = useDashboardAccess(dashboard);
  const canWrite = effectiveAccess === 'write';
  const canDelete = usePermission('dashboard:delete') && effectiveAccess === 'write';
  const canSetDefault = usePermission('dashboard:set-default');
  const isOwner = currentUserId !== null && dashboard?.owner_user_id === currentUserId;
  const [shareOpened, { open: openShare, close: closeShare }] = useDisclosure(false);
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
  const visibility = visibilityMeta(dashboard.scope);

  return (
    <Stack gap="md" p="md">
      <ShareDashboardModal opened={shareOpened} dashboard={dashboard} onClose={closeShare} />
      {/* Header */}
      <Stack gap={4}>
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" align="center" wrap="wrap">
              <Title order={titleOrder} style={{ minWidth: 0 }}>
                {dashboard.name}
              </Title>
              {/* On mobile: only show the visibility icon (no label) to keep
                  the title row scannable. Mode/Default/View-only badges drop
                  off small screens — owner can confirm via the share modal. */}
              {!isMobile && (
                <Badge
                  size="sm"
                  variant="light"
                  color={dashboard.mode === 'metabase' ? 'blue' : 'violet'}
                >
                  {dashboard.mode}
                </Badge>
              )}
              <Tooltip label={visibility.tooltip} withArrow>
                <Badge
                  size="sm"
                  variant="light"
                  color={visibility.color}
                  leftSection={visibility.icon}
                  data-testid="dashboard-visibility-badge"
                >
                  {isMobile ? '' : visibility.label}
                </Badge>
              </Tooltip>
              {dashboard.default && !isMobile && (
                <Badge size="sm" variant="light" color="green" leftSection={<IconStar size={10} />}>
                  Default
                </Badge>
              )}
              {!canWrite && effectiveAccess === 'read' && !isMobile && (
                <Badge size="sm" variant="outline" color="gray">
                  View only
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
            {isOwner &&
              (isMobile ? (
                <Tooltip label="Share" withArrow>
                  <ActionIcon
                    variant="default"
                    size="lg"
                    aria-label="Share dashboard"
                    onClick={openShare}
                    data-testid="dashboard-share-btn"
                  >
                    <IconShare size={16} />
                  </ActionIcon>
                </Tooltip>
              ) : (
                <Button
                  variant="default"
                  leftSection={<IconShare size={14} />}
                  onClick={openShare}
                  data-testid="dashboard-share-btn"
                >
                  Share
                </Button>
              ))}
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
            {!hideMakeHome &&
              (isMobile ? (
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
              ))}
            {(onVersionHistory ?? onSetDefault ?? onDelete) && (
              <Menu shadow="md" position="bottom-end" withinPortal>
                <Menu.Target>
                  <Tooltip label="More" withArrow>
                    <ActionIcon
                      variant="default"
                      size="lg"
                      aria-label="More dashboard actions"
                      data-testid="dashboard-viewer-more"
                    >
                      <IconDots size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Menu.Target>
                <Menu.Dropdown>
                  {onSetDefault && (
                    <Menu.Item
                      leftSection={<IconStar size={14} />}
                      disabled={!canSetDefault || dashboard.default}
                      onClick={() => {
                        onSetDefault(dashboard.id);
                      }}
                      data-testid="dashboard-viewer-set-default"
                    >
                      {dashboard.default ? 'Already the default' : 'Set as tenant default'}
                    </Menu.Item>
                  )}
                  {onVersionHistory && (
                    <Menu.Item
                      leftSection={<IconHistory size={14} />}
                      onClick={() => {
                        onVersionHistory(dashboard.id);
                      }}
                      data-testid="dashboard-viewer-version-history"
                    >
                      Version history
                    </Menu.Item>
                  )}
                  {onDelete && (
                    <>
                      <Menu.Divider />
                      <Menu.Item
                        leftSection={<IconTrash size={14} />}
                        color="red"
                        disabled={!canDelete}
                        onClick={() => {
                          onDelete(dashboard.id);
                        }}
                        data-testid="dashboard-viewer-delete"
                      >
                        Delete dashboard…
                      </Menu.Item>
                    </>
                  )}
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        </Group>
      </Stack>

      {/* Time range selector — lives at dashboard scope; injected into
       * useWidgetData via context so every widget re-queries when the
       * user flips it. Save button appears when the local spec differs
       * from the dashboard's saved default_range. */}
      <DashboardToolbar dashboardId={dashboard.id} canWrite={canWrite} />

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
 * Dashboard toolbar: range picker + filter chips (future) + save button.
 * Posts spec changes to the `DashboardRangeProvider` so every widget
 * re-queries on apply. Save persists the current spec to the dashboard's
 * `default_range`, hiding the save indicator.
 */
function DashboardToolbar({ dashboardId, canWrite }: { dashboardId: string; canWrite: boolean }) {
  const dashboard = useDashboardDetail(dashboardId);
  const { spec, range, setSpec } = useDashboardRange();
  const isMobile = useMatches({ base: true, sm: false });

  const savedSpec = dashboard?.default_range;
  const dirty = !specEqual(spec, savedSpec);

  const handleSave = useCallback(async () => {
    if (!dashboard) return;
    try {
      await updateDashboard(dashboard.id, { default_range: spec });
      notify.success('Default range saved', `${dashboard.name} now opens at this range.`);
    } catch (e) {
      notify.error('Save failed', (e as Error).message);
    }
  }, [dashboard, spec]);

  const handleReset = useCallback(() => {
    if (savedSpec) {
      setSpec(savedSpec);
    } else {
      setSpec({ kind: 'preset', id: '24h' });
    }
  }, [savedSpec, setSpec]);

  return (
    <Group justify="space-between" gap="sm" wrap="wrap" align="center">
      {!isMobile && (
        <Text size="xs" c="dimmed">
          Showing {range.longLabel}
        </Text>
      )}
      <Group gap="xs" wrap="wrap" style={{ marginLeft: isMobile ? 'auto' : undefined }}>
        {dirty && (
          <Badge size="sm" variant="light" color="yellow" data-testid="dashboard-toolbar-dirty">
            Unsaved
          </Badge>
        )}
        {dirty && (
          <Button
            variant="default"
            size="xs"
            onClick={handleReset}
            data-testid="dashboard-toolbar-reset"
          >
            Reset
          </Button>
        )}
        {dirty && canWrite && (
          <Button
            size="xs"
            onClick={() => {
              void handleSave();
            }}
            data-testid="dashboard-toolbar-save"
          >
            {isMobile ? 'Save' : 'Save as default'}
          </Button>
        )}
        <DashboardRangePicker value={spec} onChange={setSpec} />
      </Group>
    </Group>
  );
}

function specEqual(a: DashboardRangeSpec, b: DashboardRangeSpec | undefined): boolean {
  if (!b) {
    // No saved spec → consider current dirty if anything other than the 24h default.
    return a.kind === 'preset' && a.id === '24h';
  }
  if (a.kind !== b.kind) return false;
  if (a.kind === 'preset' && b.kind === 'preset') return a.id === b.id;
  if (a.kind === 'relative' && b.kind === 'relative') {
    return a.amount === b.amount && a.unit === b.unit;
  }
  if (a.kind === 'absolute' && b.kind === 'absolute') {
    return a.from === b.from && a.to === b.to;
  }
  return false;
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
  'bar-chart': 'riokuInfo',
  pie: 'riokuOrange',
  donut: 'riokuOrange',
  funnel: 'riokuWarning',
  'top-n': 'riokuWarning',
  table: 'riokuSuccess',
  'service-map': 'riokuInfo',
  'log-viewer': 'riokuSuccess',
  'audit-tail': 'riokuSuccess',
  gauge: 'riokuSuccess',
  heatmap: 'riokuOrange',
  'status-grid': 'riokuSuccess',
  markdown: 'riokuInfo',
  progress: 'riokuSuccess',
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
  const configAccent = typeof widget.config.accent === 'string' ? widget.config.accent : undefined;
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

function visibilityMeta(scope: 'personal' | 'shared' | 'tenant'): {
  label: string;
  color: string;
  icon: React.ReactNode;
  tooltip: string;
} {
  if (scope === 'personal') {
    return {
      label: 'Private',
      color: 'gray',
      icon: <IconLock size={10} />,
      tooltip: 'Only you can view or edit this dashboard.',
    };
  }
  if (scope === 'shared') {
    return {
      label: 'Shared',
      color: 'indigo',
      icon: <IconUsers size={10} />,
      tooltip: 'Shared with specific roles or users.',
    };
  }
  return {
    label: 'Public',
    color: 'teal',
    icon: <IconWorld size={10} />,
    tooltip: 'Visible to everyone in this tenant.',
  };
}
