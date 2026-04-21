/**
 * <TimeSeriesWidget> — line chart over time.
 *
 * Accepts two data shapes:
 *   Multi-series:  { points: { x: string; [key]: number }[]; seriesDef: { name: string; color?: string }[] }
 *   Single-series: { points: { x: string; y: number }[];     label?: string }
 *
 * The rich mock adapter always emits the multi-series shape (seriesDef present).
 * The legacy single-series shape is kept for backward compat.
 */
import { Alert, Box, Skeleton } from '@mantine/core';
import { LineChart } from '@mantine/charts';
import type { WidgetRenderProps } from '../types';

interface SeriesDef {
  name: string;
  color?: string;
}

/**
 * Unified data shape. If `seriesDef` is present and is an array, the
 * multi-series path is used. Otherwise legacy `{ points: [{x,y}] }` path.
 */
interface TimeSeriesData {
  points: Record<string, string | number>[];
  /** Multi-series metadata array (new shape) */
  series?: unknown;
  /** Optional single-series label (legacy shape) */
  label?: string;
}

function isTimeSeriesData(data: unknown): data is TimeSeriesData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { points?: unknown }).points)
  );
}

function extractSeriesDefs(series: unknown): SeriesDef[] | null {
  if (!Array.isArray(series)) return null;
  // Validate each element has a `name` string
  const defs: SeriesDef[] = [];
  for (const s of series) {
    if (typeof s === 'object' && s !== null && typeof (s as { name?: unknown }).name === 'string') {
      const typed = s as { name: string; color?: string };
      const entry: SeriesDef = { name: typed.name };
      if (typed.color !== undefined) entry.color = typed.color;
      defs.push(entry);
    }
  }
  return defs.length > 0 ? defs : null;
}

const SERIES_COLORS = ['blue.5', 'teal.5', 'red.5', 'violet.5', 'orange.5', 'green.5'];

function numFormatter(value: number): string {
  return value.toLocaleString();
}

export function TimeSeriesWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={220} width="100%" radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isTimeSeriesData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ points: [] }'}
      </Alert>
    );

  const multiSeries = extractSeriesDefs(data.series);

  if (multiSeries !== null) {
    const series = multiSeries.map((s, i) => ({
      name: s.name,
      color: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length] ?? 'blue.5',
    }));

    return (
      <Box role="img" aria-label={`Time-series for ${widget.title}`} w="100%">
        <LineChart
          h={220}
          w="100%"
          data={data.points}
          dataKey="x"
          series={series}
          curveType="monotone"
          withDots={false}
          strokeWidth={2}
          withTooltip
          withLegend={series.length > 1}
          legendProps={{ verticalAlign: 'top', height: 28 }}
          gridAxis="y"
          tickLine="y"
          yAxisProps={{ tickFormatter: numFormatter }}
        />
      </Box>
    );
  }

  // Legacy single-series path: points are { x, y } objects
  const label = typeof data.label === 'string' ? data.label : 'value';
  const chartData = data.points.map((p) => ({ x: String(p.x ?? ''), [label]: Number(p.y ?? 0) }));

  return (
    <Box role="img" aria-label={`Time-series for ${widget.title}`} w="100%">
      <LineChart
        h={220}
        w="100%"
        data={chartData}
        dataKey="x"
        series={[{ name: label, color: 'blue.5' }]}
        curveType="monotone"
        withDots={false}
        strokeWidth={2}
        withTooltip
        gridAxis="y"
        tickLine="y"
        yAxisProps={{ tickFormatter: numFormatter }}
      />
    </Box>
  );
}
