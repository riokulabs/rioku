/**
 * <GaugeWidget> — semi-circular radial gauge.
 *
 * Shows a single 0..max value as an arc. The stroke colour shifts through
 * success → warning → danger as the value crosses optional `thresholds.warn`
 * and `thresholds.crit` (expressed in the same units as `value`).
 *
 * Expected data shape:
 *   { value: number, max?: number, suffix?: string, label?: string,
 *     thresholds?: { warn?: number, crit?: number } }
 */
import { Alert, Box, Skeleton, Stack, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface GaugeData {
  value: number;
  max?: number;
  suffix?: string;
  label?: string;
  /**
   * Thresholds for the accent colour. Non-inverse (default): value >= warn →
   * amber, value >= crit → red. Inverse (e.g. uptime %, cache hit %): flip the
   * comparison — value <= warn → amber, value <= crit → red.
   */
  thresholds?: { warn?: number; crit?: number };
  /** When true, LOW values are bad (e.g. uptime, cache hit). */
  inverse?: boolean;
}

function isGaugeData(data: unknown): data is GaugeData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'value' in data &&
    typeof (data as { value: unknown }).value === 'number'
  );
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r.toFixed(0)} ${r.toFixed(0)} 0 ${String(largeArc)} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function polar(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  const rad = ((angle - 180) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function pickAccent(
  value: number,
  thresholds: GaugeData['thresholds'],
  inverse: boolean,
): { name: string; cssVar: string } {
  const cmp = (threshold: number): boolean => (inverse ? value <= threshold : value >= threshold);
  if (thresholds?.crit !== undefined && cmp(thresholds.crit))
    return { name: 'danger', cssVar: 'var(--mantine-color-riokuDanger-6)' };
  if (thresholds?.warn !== undefined && cmp(thresholds.warn))
    return { name: 'warning', cssVar: 'var(--mantine-color-riokuWarning-6)' };
  return { name: 'success', cssVar: 'var(--mantine-color-riokuSuccess-6)' };
}

const WIDTH = 180;
const HEIGHT = 110;
const CX = WIDTH / 2;
const CY = HEIGHT - 12;
const R = 72;

export function GaugeWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={HEIGHT} width={WIDTH} radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isGaugeData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ value: number }'}
      </Alert>
    );

  const max = data.max ?? 100;
  const clamped = Math.max(0, Math.min(max, data.value));
  const pct = max === 0 ? 0 : clamped / max;
  const sweep = pct * 180;
  const accent = pickAccent(data.value, data.thresholds, data.inverse === true);

  const trackPath = arcPath(CX, CY, R, 0, 180);
  const valuePath = arcPath(CX, CY, R, 0, Math.max(0.01, sweep));

  return (
    <Stack
      gap={4}
      align="center"
      h="100%"
      justify="center"
      aria-label={`${widget.title}: ${String(data.value)}${data.suffix ?? ''}`}
    >
      <Box style={{ position: 'relative', width: WIDTH, height: HEIGHT }}>
        <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}>
          <path
            d={trackPath}
            stroke="var(--mantine-color-default-border)"
            strokeWidth={12}
            strokeLinecap="round"
            fill="none"
          />
          <path
            d={valuePath}
            stroke={accent.cssVar}
            strokeWidth={12}
            strokeLinecap="round"
            fill="none"
          />
        </svg>
        <Box
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            paddingBottom: 8,
            pointerEvents: 'none',
          }}
        >
          <Stack gap={0} align="center">
            <Text fw={700} fz={22} lh={1} style={{ letterSpacing: '-0.02em' }}>
              {data.value.toLocaleString()}
              {data.suffix !== undefined && (
                <Text component="span" size="sm" c="dimmed" fw={500} ml={2}>
                  {data.suffix}
                </Text>
              )}
            </Text>
          </Stack>
        </Box>
      </Box>
      {data.label !== undefined && (
        <Text size="xs" c="dimmed">
          {data.label}
        </Text>
      )}
    </Stack>
  );
}
