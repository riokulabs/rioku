/**
 * <HeatmapWidget> — 2D heat grid (e.g. day-of-week × hour-of-day).
 *
 * Rendered as an HTML CSS grid so cells reflow to fill the card width and
 * stay legible at any size. Hovering a cell surfaces a positioned tooltip
 * with the (row, col, value) tuple — much more usable than the browser's
 * lazy `<title>` tooltip.
 *
 * Expected data shape:
 *   { xLabels: string[], yLabels: string[], cells: number[][],
 *     accent?: string, unit?: string }
 *
 * `cells` is row-major: `cells[y][x]`. Missing cells render as zero.
 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Group, Skeleton, Stack, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface HeatmapData {
  xLabels: string[];
  yLabels: string[];
  cells: number[][];
  accent?: string;
  unit?: string;
}

function isHeatmapData(data: unknown): data is HeatmapData {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as { xLabels?: unknown; yLabels?: unknown; cells?: unknown };
  return Array.isArray(d.xLabels) && Array.isArray(d.yLabels) && Array.isArray(d.cells);
}

interface HoverState {
  x: number;
  y: number;
  xLabel: string;
  yLabel: string;
  value: number;
  mouseX: number;
  mouseY: number;
}

export function HeatmapWidget({ widget, data, loading, error }: WidgetRenderProps) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [containerWidth, setContainerWidth] = useState(400);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  if (loading) return <Skeleton height={200} width="100%" radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isHeatmapData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ xLabels, yLabels, cells }'}
      </Alert>
    );

  const accent = data.accent ?? 'riokuOrange';
  const accentVar = `var(--mantine-color-${accent}-6)`;

  const cols = data.xLabels.length;
  const rows = data.yLabels.length;
  if (cols === 0 || rows === 0) {
    return (
      <Alert color="yellow" title="Empty heatmap" variant="light">
        No data to plot.
      </Alert>
    );
  }

  let max = 0;
  for (const row of data.cells) {
    for (const v of row) if (v > max) max = v;
  }
  const denom = max === 0 ? 1 : max;

  // Derive which x labels get rendered — too many become illegible, so we
  // stride: every Nth label where N keeps us under ~12 labels total.
  const labelStride = Math.max(1, Math.ceil(cols / 12));

  return (
    <Box
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%' }}
      aria-label={`Heatmap for ${widget.title}`}
      role="img"
      onMouseLeave={() => {
        setHover(null);
      }}
    >
      <Stack gap={4} h="100%">
        {/* Column header */}
        <Group gap={0} wrap="nowrap" pl={40}>
          {data.xLabels.map((xl, xi) => (
            <Box key={`x-${String(xi)}`} style={{ flex: 1, textAlign: 'left' }}>
              {xi % labelStride === 0 && (
                <Text size="xs" c="dimmed" ff="monospace">
                  {xl}
                </Text>
              )}
            </Box>
          ))}
        </Group>
        {/* Rows */}
        <Stack gap={2} style={{ flex: 1, minHeight: 0 }}>
          {data.cells.map((row, yi) => (
            <Group key={`r-${String(yi)}`} gap={2} wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
              <Text
                size="xs"
                c="dimmed"
                ff="monospace"
                style={{ width: 36, textAlign: 'right', flexShrink: 0 }}
              >
                {data.yLabels[yi]}
              </Text>
              <Box
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${String(cols)}, minmax(0, 1fr))`,
                  gap: 2,
                  flex: 1,
                }}
              >
                {row.map((v, xi) => {
                  const intensity = Math.max(0.05, v / denom);
                  const xl = data.xLabels[xi] ?? String(xi);
                  const yl = data.yLabels[yi] ?? String(yi);
                  const isHovered = hover?.x === xi && hover.y === yi;
                  return (
                    <Box
                      key={`c-${String(yi)}-${String(xi)}`}
                      style={{
                        aspectRatio: '1',
                        borderRadius: 2,
                        background: accentVar,
                        opacity: intensity,
                        cursor: 'pointer',
                        outline: isHovered
                          ? `1px solid var(--mantine-color-text)`
                          : '1px solid transparent',
                        transition: 'outline 80ms ease-out',
                      }}
                      onMouseEnter={(e) => {
                        const rect = containerRef.current?.getBoundingClientRect();
                        setHover({
                          x: xi,
                          y: yi,
                          xLabel: xl,
                          yLabel: yl,
                          value: v,
                          mouseX: e.clientX - (rect?.left ?? 0),
                          mouseY: e.clientY - (rect?.top ?? 0),
                        });
                      }}
                      onMouseMove={(e) => {
                        const rect = containerRef.current?.getBoundingClientRect();
                        setHover({
                          x: xi,
                          y: yi,
                          xLabel: xl,
                          yLabel: yl,
                          value: v,
                          mouseX: e.clientX - (rect?.left ?? 0),
                          mouseY: e.clientY - (rect?.top ?? 0),
                        });
                      }}
                    />
                  );
                })}
              </Box>
            </Group>
          ))}
        </Stack>
      </Stack>
      {hover && (
        <Box
          role="tooltip"
          style={{
            position: 'absolute',
            left: Math.min(hover.mouseX + 12, containerWidth - 160),
            top: Math.max(0, hover.mouseY - 50),
            pointerEvents: 'none',
            background: 'var(--mantine-color-default)',
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 8,
            padding: '6px 10px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
            zIndex: 10,
            minWidth: 140,
          }}
        >
          <Text size="xs" fw={600}>
            {hover.yLabel} · {hover.xLabel}
          </Text>
          <Group gap={4} wrap="nowrap" mt={2}>
            <Text size="xs" c="dimmed">
              Value:
            </Text>
            <Text size="xs" ff="monospace">
              {hover.value.toLocaleString()}
              {data.unit !== undefined ? ` ${data.unit}` : ''}
            </Text>
          </Group>
        </Box>
      )}
    </Box>
  );
}
