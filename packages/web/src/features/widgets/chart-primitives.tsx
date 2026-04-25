/**
 * Shared chart primitives.
 *
 * Single source of truth for the visual language of every recharts widget:
 *   - <ChartTooltip>      — dark card, monospace numbers, delta line.
 *   - <ChartGradient>     — top-down gradient fill <defs> for areas.
 *   - <DeltaPill>         — colored pill for "+12.4% vs prev" deltas.
 *   - <ChartSkeleton>     — shape-matched loading skeleton.
 *   - chartGridProps()    — sane CartesianGrid defaults.
 *   - chartAxisProps()    — sane XAxis/YAxis defaults.
 *   - CHART_COLORS        — categorical palette references (CSS vars).
 *
 * Designed for the rioku dashboard product. Keep visual changes here so we
 * don't duplicate the same Recharts boilerplate across 15+ widget files.
 */
import { Box, Group, Stack, Text } from '@mantine/core';
import { IconTrendingDown, IconTrendingUp, IconMinus } from '@tabler/icons-react';
import type { ReactNode } from 'react';

// ─── Categorical palette ──────────────────────────────────────────────────────
//
// Resolved via CSS variables defined in src/theme. Falls back to Mantine
// palette accents if a theme has not declared the chart-N tokens.

export const CHART_COLORS = {
  1: 'var(--chart-1, var(--mantine-color-riokuOrange-6))',
  2: 'var(--chart-2, var(--mantine-color-riokuInfo-6))',
  3: 'var(--chart-3, var(--mantine-color-riokuSuccess-6))',
  4: 'var(--chart-4, var(--mantine-color-riokuWarning-6))',
  5: 'var(--chart-5, var(--mantine-color-riokuDanger-6))',
  6: 'var(--chart-6, var(--mantine-color-grape-6))',
  7: 'var(--chart-7, var(--mantine-color-cyan-6))',
} as const;

export const CHART_COLOR_LIST: readonly string[] = [
  CHART_COLORS[1],
  CHART_COLORS[2],
  CHART_COLORS[3],
  CHART_COLORS[4],
  CHART_COLORS[5],
  CHART_COLORS[6],
  CHART_COLORS[7],
];

// Severity tokens — semantic, not categorical. Use for thresholds, deltas.
export const SEVERITY = {
  success: 'var(--mantine-color-riokuSuccess-6)',
  warn: 'var(--mantine-color-riokuWarning-6)',
  danger: 'var(--mantine-color-riokuDanger-6)',
  info: 'var(--mantine-color-riokuInfo-6)',
  neutral: 'var(--mantine-color-dimmed)',
} as const;

// ─── ChartTooltip ─────────────────────────────────────────────────────────────

interface TooltipPayloadEntry {
  name?: string;
  dataKey?: string | number;
  value?: number | string | null;
  color?: string;
  payload?: Record<string, unknown>;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  /** Optional formatter for individual values (e.g. unit suffix). */
  valueFormatter?: (value: number, entry: TooltipPayloadEntry) => string;
  /** Optional label for the timestamp / x-axis row. Defaults to the raw label. */
  labelFormatter?: (label: string | number | undefined) => string;
}

/** Default value formatter — locale-thousands + tabular-nums via CSS. */
export function defaultValueFormatter(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString();
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter = (v) => defaultValueFormatter(v),
  labelFormatter,
}: ChartTooltipProps) {
  if (active !== true || !payload || payload.length === 0) return null;
  const labelText =
    labelFormatter !== undefined
      ? labelFormatter(label)
      : label !== undefined
        ? String(label)
        : null;

  return (
    <Box
      style={{
        background: 'rgba(17,17,20,0.96)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        padding: '8px 10px',
        minWidth: 140,
        backdropFilter: 'blur(8px)',
      }}
    >
      {labelText !== null && (
        <Text size="xs" c="dimmed" mb={6} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {labelText}
        </Text>
      )}
      <Stack gap={4}>
        {payload.map((entry, i) => {
          const value =
            typeof entry.value === 'number'
              ? valueFormatter(entry.value, entry)
              : String(entry.value ?? '—');
          const name = entry.name ?? String(entry.dataKey ?? `series-${String(i)}`);
          return (
            <Group key={i} gap="xs" wrap="nowrap" justify="space-between">
              <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                <Box
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: entry.color ?? 'var(--mantine-color-dimmed)',
                    flexShrink: 0,
                  }}
                />
                <Text size="xs" style={{ color: 'rgba(255,255,255,0.85)' }} truncate>
                  {name}
                </Text>
              </Group>
              <Text
                size="xs"
                ff="monospace"
                fw={600}
                style={{ color: 'rgba(255,255,255,0.95)', fontVariantNumeric: 'tabular-nums' }}
              >
                {value}
              </Text>
            </Group>
          );
        })}
      </Stack>
    </Box>
  );
}

// ─── ChartGradient ────────────────────────────────────────────────────────────
//
// Drop-in <defs> for a top-down gradient. Pass to <Area fill={`url(#${id})`} />.

export function ChartGradient({
  id,
  color,
  from = 0.28,
  to = 0,
}: {
  id: string;
  color: string;
  from?: number;
  to?: number;
}) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={from} />
        <stop offset="100%" stopColor={color} stopOpacity={to} />
      </linearGradient>
    </defs>
  );
}

// ─── chartGridProps / chartAxisProps ─────────────────────────────────────────

export function chartGridProps() {
  return {
    vertical: false as const,
    stroke: 'var(--mantine-color-default-border)',
    strokeOpacity: 0.5,
  };
}

/**
 * Axis defaults compatible with recharts' XAxis/YAxis. The `tick` prop wants
 * an SVGProps<SVGTextElement>-shaped object — not a CSSProperties — so we
 * pass the styling props at the SVG level (`fontSize`, `fill`).
 */
export function chartAxisProps(opts: { hide?: boolean; width?: number } = {}): {
  axisLine: false;
  tickLine: false;
  tick: { fontSize: number; fill: string; style: { fontVariantNumeric: 'tabular-nums' } };
  width?: number;
  hide?: boolean;
} {
  const tick = {
    fontSize: 11,
    fill: 'var(--mantine-color-dimmed)',
    style: { fontVariantNumeric: 'tabular-nums' as const },
  };
  if (opts.width !== undefined && opts.hide === true) {
    return { axisLine: false, tickLine: false, tick, width: opts.width, hide: true };
  }
  if (opts.width !== undefined) {
    return { axisLine: false, tickLine: false, tick, width: opts.width };
  }
  if (opts.hide === true) {
    return { axisLine: false, tickLine: false, tick, hide: true };
  }
  return { axisLine: false, tickLine: false, tick };
}

// ─── DeltaPill ───────────────────────────────────────────────────────────────

interface DeltaPillProps {
  /** Delta value (e.g. 12.4 for +12.4%). */
  value: number;
  /** Number of decimals to display. Default 1. */
  decimals?: number;
  /**
   * Suffix shown after the delta in muted text, e.g. "vs prev". Empty string
   * to omit. Default 'vs prev'.
   */
  suffix?: string;
  /**
   * Render as a percentage (default true). Set false to render the raw delta
   * with no `%` sign — useful for absolute-value deltas like "+42 added".
   */
  percent?: boolean;
  /**
   * If true, a positive delta is treated as a regression (e.g. error rate).
   * Defaults to false (positive = good).
   */
  inverse?: boolean;
}

export function DeltaPill({
  value,
  decimals = 1,
  suffix = 'vs prev',
  percent = true,
  inverse = false,
}: DeltaPillProps) {
  const isPositive = value > 0;
  const isNegative = value < 0;
  const isZero = value === 0;
  const good = (isPositive && !inverse) || (isNegative && inverse);
  const bad = (isNegative && !inverse) || (isPositive && inverse);
  const color = isZero ? SEVERITY.neutral : good ? SEVERITY.success : bad ? SEVERITY.danger : SEVERITY.neutral;

  const Icon = isZero ? IconMinus : isPositive ? IconTrendingUp : IconTrendingDown;
  const sign = isPositive ? '+' : '';
  const formatted = `${sign}${value.toFixed(decimals)}${percent ? '%' : ''}`;

  return (
    <Group gap={6} wrap="nowrap" align="center">
      <Group
        gap={3}
        wrap="nowrap"
        align="center"
        px={6}
        py={2}
        style={{
          borderRadius: 999,
          background: tintBg(color),
          color: color,
          fontSize: 11,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.2,
        }}
      >
        <Icon size={11} />
        <span>{formatted}</span>
      </Group>
      {suffix.length > 0 && (
        <Text size="xs" c="dimmed">
          {suffix}
        </Text>
      )}
    </Group>
  );
}

/**
 * Build a CSS color-mix tint for the pill background. Uses the modern
 * `color-mix` function which is well-supported in 2025+.
 */
function tintBg(color: string): string {
  return `color-mix(in srgb, ${color} 14%, transparent)`;
}

// ─── ChartSkeleton ────────────────────────────────────────────────────────────

interface ChartSkeletonProps {
  kind: 'line' | 'bar' | 'sparkline' | 'kpi' | 'pie';
  height?: number;
}

/**
 * Shape-matched skeletons. Match the contour of the eventual chart so the
 * UI doesn't flash from a generic grey block into a chart of a different
 * shape on load.
 */
export function ChartSkeleton({ kind, height }: ChartSkeletonProps) {
  const h = height ?? defaultHeightForKind(kind);
  return (
    <Box
      role="progressbar"
      aria-busy="true"
      aria-label="Loading widget"
      style={{
        width: '100%',
        height: h,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 6,
      }}
    >
      <Box
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--mantine-color-default-hover)',
          opacity: 0.45,
          maskImage: maskForKind(kind),
          WebkitMaskImage: maskForKind(kind),
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskSize: '100% 100%',
          WebkitMaskSize: '100% 100%',
        }}
      />
      <Box
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, transparent, var(--mantine-color-default-border), transparent)',
          backgroundSize: '200% 100%',
          animation: 'rioku-shimmer 1100ms linear infinite',
        }}
      />
      <style>{`@keyframes rioku-shimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }`}</style>
    </Box>
  );
}

function defaultHeightForKind(kind: ChartSkeletonProps['kind']): number {
  if (kind === 'sparkline') return 40;
  if (kind === 'kpi') return 80;
  return 180;
}

function maskForKind(kind: ChartSkeletonProps['kind']): string {
  // Use SVG masks shaped like the chart so the shimmer reveals the silhouette.
  const svg = (() => {
    switch (kind) {
      case 'line':
      case 'sparkline':
        return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 30' preserveAspectRatio='none'><path d='M0 22 L10 18 L20 24 L30 12 L40 16 L50 8 L60 14 L70 6 L80 12 L90 4 L100 10 L100 30 L0 30 Z' fill='black'/></svg>`;
      case 'bar': {
        let bars = '';
        const heights = [16, 22, 12, 28, 18, 24, 14, 26];
        const bw = 100 / heights.length;
        heights.forEach((bh, i) => {
          const x = i * bw + 1;
          bars += `<rect x='${String(x)}' y='${String(30 - bh)}' width='${String(bw - 2)}' height='${String(bh)}' rx='1.5' fill='black'/>`;
        });
        return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 30' preserveAspectRatio='none'>${bars}</svg>`;
      }
      case 'kpi':
        return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 30' preserveAspectRatio='none'><rect x='0' y='6' width='40' height='10' rx='2' fill='black'/><rect x='0' y='20' width='22' height='4' rx='1' fill='black'/></svg>`;
      case 'pie':
        return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='xMidYMid meet'><circle cx='50' cy='50' r='38' fill='black'/></svg>`;
    }
  })();
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

// ─── Container query helper ───────────────────────────────────────────────────
//
// Wrap a widget root in this `Box` to enable `@container` queries inside its
// chart so legend/axes can degrade gracefully without JS measurement.

export function WidgetContainer({ children }: { children: ReactNode }) {
  return <Box style={{ containerType: 'inline-size', height: '100%' }}>{children}</Box>;
}
