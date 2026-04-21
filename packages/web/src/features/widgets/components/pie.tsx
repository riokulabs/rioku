/**
 * <PieWidget> — pie chart over categorical aggregation.
 *
 * Expected data shape: { slices: { name: string; value: number; color?: string }[] }.
 */
import { Alert, Box, Skeleton } from '@mantine/core';
import { PieChart } from '@mantine/charts';
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

const FALLBACK_COLORS = ['blue.6', 'green.6', 'orange.6', 'grape.6', 'teal.6', 'red.6'];

export function PieWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={200} width={200} circle />;
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

  const slices = data.slices.map((s, i) => ({
    name: s.name,
    value: s.value,
    color: s.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] ?? 'blue.6',
  }));

  return (
    <Box
      role="img"
      aria-label={`Pie chart for ${widget.title}`}
      style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
    >
      {/* size controls the SVG diameter; centre it in the full-width Box */}
      <PieChart size={160} data={slices} withTooltip />
    </Box>
  );
}
