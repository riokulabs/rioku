/**
 * <PieWidget> — pie chart over categorical aggregation.
 *
 * Rewritten on recharts direct (rather than Mantine's PieChart) so we can
 * style the tooltip (dark card), draw leader-line labels with percentages,
 * and render a wrap-friendly legend that doesn't overflow narrow cards.
 *
 * Expected data shape: { slices: { name: string; value: number; color?: string }[] }.
 */
import { Alert, Box, Group, Skeleton, Stack, Text } from '@mantine/core';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { WidgetRenderProps } from '../types';

interface PieData {
  slices: { name: string; value: number; color?: string }[];
}

function isPieData(data: unknown): data is PieData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { slices?: unknown }).slices)
  );
}

const FALLBACK_ACCENTS = ['riokuSuccess', 'riokuInfo', 'riokuWarning', 'riokuDanger', 'riokuOrange'];

/** Resolve a palette name (Mantine color slug) to a CSS var against shade-6. */
function accentVar(name: string): string {
  // Special-case bare Mantine palette names ('green', 'red', etc.) to keep
  // backward compat with seeds that rely on Mantine built-ins.
  return `var(--mantine-color-${name}-6)`;
}

interface TooltipEntry {
  name?: string;
  value?: number;
  payload?: { name: string; value: number; color: string; percent: number };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  if (active !== true || !payload || payload.length === 0) return null;
  const entry = payload[0]?.payload;
  if (!entry) return null;
  return (
    <Box
      style={{
        background: 'var(--mantine-color-default)',
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 8,
        padding: '6px 10px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        minWidth: 140,
      }}
    >
      <Group gap={6} wrap="nowrap">
        <Box
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: entry.color,
            flexShrink: 0,
          }}
        />
        <Text size="xs" fw={600}>
          {entry.name}
        </Text>
      </Group>
      <Group gap="xs" mt={2} wrap="nowrap">
        <Text size="xs" c="dimmed">
          Value:
        </Text>
        <Text size="xs" ff="monospace">
          {entry.value.toLocaleString()}
        </Text>
        <Text size="xs" c="dimmed">
          · {(entry.percent * 100).toFixed(1)}%
        </Text>
      </Group>
    </Box>
  );
}

export function PieWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={160} width="100%" radius="md" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isPieData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ slices: [] }'}
      </Alert>
    );

  const total = data.slices.reduce((sum, s) => sum + s.value, 0);
  const resolved = data.slices.map((s, i) => {
    const color = s.color ?? FALLBACK_ACCENTS[i % FALLBACK_ACCENTS.length] ?? 'riokuOrange';
    return {
      name: s.name,
      value: s.value,
      color: accentVar(color),
      percent: total === 0 ? 0 : s.value / total,
    };
  });

  return (
    <Stack
      gap={6}
      h="100%"
      aria-label={`Pie chart for ${widget.title}`}
      style={{ minHeight: 180 }}
    >
      <Box style={{ flex: 1, minHeight: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={resolved}
              dataKey="value"
              nameKey="name"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={2}
              stroke="var(--mantine-color-body)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {resolved.map((s) => (
                // eslint-disable-next-line @typescript-eslint/no-deprecated -- recharts types mark Cell deprecated but it is the idiomatic per-slice color API.
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </Box>
      {/* Legend below the donut — readable even on narrow cards. */}
      <Group gap={10} wrap="wrap" justify="center">
        {resolved.map((s) => (
          <Group key={s.name} gap={4} wrap="nowrap">
            <Box
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: s.color,
                flexShrink: 0,
              }}
            />
            <Text size="xs" style={{ whiteSpace: 'nowrap' }}>
              {s.name}
            </Text>
            <Text size="xs" c="dimmed" ff="monospace">
              {(s.percent * 100).toFixed(0)}%
            </Text>
          </Group>
        ))}
      </Group>
    </Stack>
  );
}
