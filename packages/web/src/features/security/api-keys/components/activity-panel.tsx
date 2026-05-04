/**
 * <ApiKeyActivityPanel> — usage history + audit trail for a single API key.
 *
 * Synthesises a usage sparkline from a deterministic seed (mock-only — real
 * stage-2 will read from a usage-events table). Audit entries are pulled
 * live from the mock store and filtered by `resource_id === keyId`.
 *
 * Layout: a small KPI strip across the top (Last used / Total calls / Avg
 * latency / Error rate), a usage area chart below, then an audit timeline.
 */
import { useMemo } from 'react';
import { Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useMockStore } from '@/api/mock-store';
import {
  ChartTooltip,
  chartAxisProps,
  chartGridProps,
  DeltaPill,
} from '@/features/widgets/chart-primitives';
import type { ApiKey } from '@/api/resources/types';

dayjs.extend(relativeTime);

interface ApiKeyActivityPanelProps {
  apiKey: ApiKey;
  /** Time window in days to show in the usage chart. Default 14. */
  windowDays?: number;
}

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

interface UsagePoint {
  day: string;
  calls: number;
  errors: number;
}

/**
 * Deterministic mock usage series — daily call counts seeded from the key id.
 * Active keys get higher baselines; revoked keys taper to zero.
 */
function buildUsageSeries(apiKey: ApiKey, windowDays: number): UsagePoint[] {
  const seed = djb2(apiKey.id);
  const baseline = apiKey.revoked ? 0 : 80 + (seed % 220);
  const now = dayjs();
  const points: UsagePoint[] = [];

  // If revoked, taper from baseline → 0 across the window so the chart
  // shows the historical activity that stopped at revocation.
  for (let i = windowDays - 1; i >= 0; i--) {
    const day = now.subtract(i, 'day');
    const wave = Math.sin((seed + i * 17) % 13) * 0.35 + 1;
    const noise = ((seed + i * 4093) % 30) - 15;
    let calls: number;
    if (apiKey.revoked) {
      const tapered = Math.max(0, baseline * (i / windowDays) - noise);
      calls = i === 0 ? 0 : Math.round(tapered);
    } else {
      calls = Math.max(0, Math.round(baseline * wave + noise));
    }
    const errors = Math.max(0, Math.round(calls * (0.02 + ((seed + i * 911) % 6) / 200)));
    points.push({ day: day.format('MMM D'), calls, errors });
  }
  return points;
}

/** Average latency synthesis — deterministic per key. */
function mockAvgLatency(apiKey: ApiKey): number {
  const seed = djb2(apiKey.id);
  return 80 + (seed % 220);
}

export function ApiKeyActivityPanel({ apiKey, windowDays = 14 }: ApiKeyActivityPanelProps) {
  const audit = useMockStore((s) => s.audit);
  const users = useMockStore((s) => s.users);

  const series = useMemo(() => buildUsageSeries(apiKey, windowDays), [apiKey, windowDays]);

  const totalCalls = series.reduce((acc, p) => acc + p.calls, 0);
  const totalErrors = series.reduce((acc, p) => acc + p.errors, 0);
  const errorRate = totalCalls === 0 ? 0 : (totalErrors / totalCalls) * 100;
  const avgLatency = mockAvgLatency(apiKey);

  // Compare current half-window vs previous half-window for delta pill.
  const half = Math.floor(series.length / 2);
  const prevHalf = series.slice(0, half).reduce((acc, p) => acc + p.calls, 0);
  const curHalf = series.slice(half).reduce((acc, p) => acc + p.calls, 0);
  const deltaPct = prevHalf === 0 ? 0 : ((curHalf - prevHalf) / prevHalf) * 100;

  const auditEntries = useMemo(() => {
    return audit
      .filter(
        (e) =>
          (e.resource_type === 'api-key' || e.resource_type === 'apikey') &&
          e.resource_id === apiKey.id,
      )
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 20);
  }, [audit, apiKey.id]);

  const stroke = 'var(--mantine-color-riokuInfo-6)';
  const errStroke = 'var(--mantine-color-riokuDanger-6)';
  const gradId = `apikey-usage-${apiKey.id}`;

  return (
    <Stack gap="md">
      {/* KPI strip */}
      <Group gap="lg" wrap="wrap">
        <KpiCell
          label="Total calls"
          value={totalCalls.toLocaleString()}
          extra={<DeltaPill value={deltaPct} suffix="vs prev half" decimals={1} />}
        />
        <KpiCell label="Avg latency" value={`${String(avgLatency)} ms`} />
        <KpiCell
          label="Error rate"
          value={`${errorRate.toFixed(2)}%`}
          tone={errorRate >= 5 ? 'danger' : errorRate >= 1 ? 'warn' : 'ok'}
        />
        <KpiCell
          label="Last used"
          value={apiKey.last_used ? dayjs(apiKey.last_used).fromNow() : '—'}
        />
      </Group>

      {/* Usage area chart */}
      <Box style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...chartGridProps()} />
            <XAxis dataKey="day" {...chartAxisProps()} minTickGap={20} />
            <YAxis {...chartAxisProps({ width: 32 })} />
            <ReTooltip
              content={<ChartTooltip />}
              cursor={{
                stroke: 'var(--mantine-color-default-border)',
                strokeWidth: 1,
                strokeDasharray: '2 4',
              }}
            />
            <Area
              type="monotone"
              dataKey="calls"
              stroke={stroke}
              strokeWidth={2}
              fill={`url(#${gradId})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--mantine-color-body)' }}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="errors"
              stroke={errStroke}
              strokeWidth={1.5}
              fill="transparent"
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>

      {/* Audit timeline */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Recent events
        </Text>
        {auditEntries.length === 0 ? (
          <Text size="xs" c="dimmed">
            No events recorded for this key yet.
          </Text>
        ) : (
          <Stack gap={0} pl={8} style={{ position: 'relative' }}>
            <Box
              aria-hidden
              style={{
                position: 'absolute',
                left: 11,
                top: 6,
                bottom: 6,
                width: 1,
                background: 'var(--mantine-color-default-border)',
              }}
            />
            {auditEntries.map((e) => {
              const actor = users[e.actor_id];
              const at = dayjs(e.at);
              const dotColor =
                e.outcome === 'success'
                  ? 'var(--mantine-color-riokuSuccess-6)'
                  : e.outcome === 'denied'
                    ? 'var(--mantine-color-riokuWarning-6)'
                    : 'var(--mantine-color-riokuDanger-6)';
              return (
                <Group key={e.id} gap="xs" wrap="nowrap" align="center" py={4} pr="xs">
                  <Box
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: dotColor,
                      boxShadow: `0 0 0 3px var(--mantine-color-body), 0 0 6px ${dotColor}`,
                      flexShrink: 0,
                      marginLeft: -1,
                    }}
                  />
                  <Tooltip label={at.format('YYYY-MM-DD HH:mm:ss')} withArrow>
                    <Text size="xs" c="dimmed" ff="monospace" w={68} style={{ flexShrink: 0 }}>
                      {at.fromNow()}
                    </Text>
                  </Tooltip>
                  <Text size="xs" fw={600} truncate style={{ flex: 1, minWidth: 0 }}>
                    {e.action}
                  </Text>
                  <Text size="xs" c="dimmed" truncate style={{ maxWidth: 140 }}>
                    {actor?.name ?? actor?.email ?? e.actor_id}
                  </Text>
                </Group>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}

interface KpiCellProps {
  label: string;
  value: string;
  extra?: React.ReactNode;
  tone?: 'ok' | 'warn' | 'danger';
}

function KpiCell({ label, value, extra, tone }: KpiCellProps) {
  const valueColor =
    tone === 'danger'
      ? 'var(--mantine-color-riokuDanger-6)'
      : tone === 'warn'
        ? 'var(--mantine-color-riokuWarning-6)'
        : undefined;
  return (
    <Stack gap={2} style={{ minWidth: 120 }}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: '0.04em' }}>
        {label}
      </Text>
      <Text fw={700} size="lg" style={{ fontVariantNumeric: 'tabular-nums', color: valueColor }}>
        {value}
      </Text>
      {extra}
    </Stack>
  );
}
