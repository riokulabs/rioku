/**
 * <WidgetPalette> — left-sidebar list of draggable widget-type chips.
 *
 * Each chip is a `@dnd-kit/core` draggable with id `palette-<kind>`. On drop
 * onto the <GridCanvas>, the canvas creates a new widget of that kind. Chips
 * are filtered/disabled by the current dashboard mode:
 *   - metabase: `clean` + `one-way` types both allowed (one-way goes straight to advanced)
 *   - grafana:  all types allowed (dashboard is already in advanced mode)
 *
 * We render the chip via both a real `useDraggable` node (the real Card) and
 * a keyboard-focusable trigger so screen-reader + keyboard users can initiate
 * the drag (dnd-kit's default keyboard sensor handles arrow-key positioning).
 */
import type { ReactNode } from 'react';
import { Card, Group, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { useDraggable } from '@dnd-kit/core';
import {
  IconChartArea,
  IconChartBar,
  IconChartDonut,
  IconChartDots,
  IconChartLine,
  IconChartPie,
  IconFilter,
  IconLayoutGrid,
  IconList,
  IconListDetails,
  IconMarkdown,
  IconProgress,
  IconScale,
  IconServerCog,
  IconTable,
} from '@tabler/icons-react';
import { BUILT_IN_WIDGETS } from '@/features/widgets/registry';
import type { Dashboard } from '@/api/resources/types';
import type { WidgetTypeDefinition } from '@/features/widgets/types';

function renderIcon(kind: string): ReactNode {
  const size = 16;
  switch (kind) {
    case 'single-stat':
      return <IconScale size={size} />;
    case 'sparkline':
      return <IconChartDots size={size} />;
    case 'time-series':
      return <IconChartLine size={size} />;
    case 'stacked-bar':
    case 'bar-chart':
      return <IconChartBar size={size} />;
    case 'table':
      return <IconTable size={size} />;
    case 'pie':
      return <IconChartPie size={size} />;
    case 'donut':
      return <IconChartDonut size={size} />;
    case 'funnel':
      return <IconFilter size={size} />;
    case 'service-map':
      return <IconServerCog size={size} />;
    case 'log-viewer':
      return <IconListDetails size={size} />;
    case 'audit-tail':
      return <IconList size={size} />;
    case 'top-n':
      return <IconLayoutGrid size={size} />;
    case 'markdown':
      return <IconMarkdown size={size} />;
    case 'progress':
      return <IconProgress size={size} />;
    default:
      return <IconChartArea size={size} />;
  }
}

export interface WidgetPaletteProps {
  dashboard: Dashboard;
}

export function WidgetPalette({ dashboard }: WidgetPaletteProps) {
  const types = Object.values(BUILT_IN_WIDGETS);
  return (
    <Stack gap="xs" p="sm" aria-label="Widget palette">
      <Text size="xs" fw={700} c="var(--mantine-color-gray-7)">
        Widget types
      </Text>
      {types.map((def) => {
        // In Metabase mode, one-way widgets are still allowed — adding one
        // just starts it in advanced mode. Disabling would hide useful
        // charts, so we only mark the mode in the tooltip instead.
        const disabled = false;
        const modeLabel =
          dashboard.mode === 'metabase' && def.roundTripMode === 'one-way'
            ? 'Advanced-mode only'
            : undefined;
        return <PaletteItem key={def.type} def={def} disabled={disabled} modeLabel={modeLabel} />;
      })}
    </Stack>
  );
}

interface PaletteItemProps {
  def: WidgetTypeDefinition;
  disabled: boolean;
  modeLabel: string | undefined;
}

function PaletteItem({ def, disabled, modeLabel }: PaletteItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${def.type}`,
    disabled,
  });

  const card = (
    <Card
      ref={setNodeRef}
      withBorder
      radius="md"
      p="xs"
      aria-label={`Add ${def.displayName} widget`}
      data-testid={`palette-${def.type}`}
      data-disabled={disabled ? 'true' : undefined}
      {...attributes}
      {...listeners}
      style={{
        cursor: disabled ? 'not-allowed' : 'grab',
        opacity: isDragging ? 0.6 : disabled ? 0.5 : 1,
        filter: disabled ? 'grayscale(1)' : undefined,
      }}
    >
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <ThemeIcon variant="light" size="md">
          {renderIcon(def.type)}
        </ThemeIcon>
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="sm" fw={600} truncate>
            {def.displayName}
          </Text>
          <Text size="xs" c="var(--mantine-color-gray-7)" lineClamp={2}>
            {def.description}
          </Text>
        </Stack>
      </Group>
    </Card>
  );

  return modeLabel !== undefined ? (
    <Tooltip label={modeLabel} withArrow position="right">
      {card}
    </Tooltip>
  ) : (
    card
  );
}
