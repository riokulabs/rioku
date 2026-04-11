import { useState, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Hash, Clock, Gauge, AlertTriangle } from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { StatCard } from '@/components/rioku/stat-card'
import { ChartTooltip, type TooltipPayload } from '@/components/rioku/chart-tooltip'
import { TimezoneCaption } from '@/components/rioku/timezone-caption'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { apiClient } from '@/lib/api'

type TimeRange = '1h' | '6h' | '24h' | '7d'

// Stats API response shape (from /api/v1/traffic/stats)
interface StatsBucket {
  bucketStart: string
  requestCount: number
  errorCount: number
  errorRate: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  bytesSent: number
  bytesRecv: number
  error4xx: number
  error502: number
  error503: number
  error429: number
  error5xxOther: number
  status2xx: number
  status3xx: number
  status4xx: number
  status5xx: number
}

interface TrafficStatsResponse {
  buckets: StatsBucket[]
}

interface TopRoutesResponse {
  topRoutes: Array<{ route: string; count: number }>
}

// Internal shape consumed by the page
interface AnalyticsData {
  requestRate: Array<{ time: string; requests: number }>
  errorStacked: Array<{
    time: string
    '4xx': number
    '502': number
    '503': number
    '429': number
    '5xx Other': number
  }>
  latencyPercentiles: Array<{ time: string; p50: number; p95: number; p99: number }>
  statusBreakdown: Array<{ code: string; count: number }>
  totalRequests: number
  avgLatency: number
  p99Latency: number
  errorRatePercent: number
}

const TIME_RANGE_MS: Record<TimeRange, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

const TIME_RANGE_INTERVAL: Record<TimeRange, string> = {
  '1h': 'minute',
  '6h': 'minute',
  '24h': 'hour',
  '7d': 'day',
}

const ERROR_COLORS = {
  '4xx': '#eab308',
  '502': '#ef4444',
  '503': '#f97316',
  '429': '#a855f7',
  '5xx Other': '#991b1b',
} as const

const STATUS_COLORS: Record<string, string> = {
  '2xx': '#22c55e',
  '3xx': '#3b82f6',
  '4xx': '#eab308',
  '5xx': '#ef4444',
}

const LATENCY_COLORS = {
  p50: '#3b82f6',
  p95: '#eab308',
  p99: '#ef4444',
} as const

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function transformStats(resp: TrafficStatsResponse): AnalyticsData {
  const buckets = resp.buckets ?? []

  const totalRequests = buckets.reduce((s, b) => s + (b.requestCount ?? 0), 0)
  const totalErrors = buckets.reduce((s, b) => s + (b.errorCount ?? 0), 0)
  const avgLatency =
    buckets.length > 0
      ? Math.round(
          buckets.reduce((s, b) => s + (b.p50LatencyMs ?? 0), 0) /
            buckets.length,
        )
      : 0
  const p99Latency =
    buckets.length > 0
      ? Math.max(...buckets.map((b) => b.p99LatencyMs ?? 0))
      : 0
  const errorRatePercent =
    totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0

  const requestRate = buckets.map((b) => ({
    time: formatTime(b.bucketStart),
    requests: b.requestCount ?? 0,
  }))

  const errorStacked = buckets.map((b) => ({
    time: formatTime(b.bucketStart),
    '4xx': b.error4xx ?? 0,
    '502': b.error502 ?? 0,
    '503': b.error503 ?? 0,
    '429': b.error429 ?? 0,
    '5xx Other': b.error5xxOther ?? 0,
  }))

  const latencyPercentiles = buckets.map((b) => ({
    time: formatTime(b.bucketStart),
    p50: b.p50LatencyMs ?? 0,
    p95: b.p95LatencyMs ?? 0,
    p99: b.p99LatencyMs ?? 0,
  }))

  // Aggregate status code breakdown
  const total2xx = buckets.reduce((s, b) => s + (b.status2xx ?? 0), 0)
  const total3xx = buckets.reduce((s, b) => s + (b.status3xx ?? 0), 0)
  const total4xx = buckets.reduce((s, b) => s + (b.status4xx ?? 0), 0)
  const total5xx = buckets.reduce((s, b) => s + (b.status5xx ?? 0), 0)

  const statusBreakdown = [
    { code: '2xx', count: total2xx },
    { code: '3xx', count: total3xx },
    { code: '4xx', count: total4xx },
    { code: '5xx', count: total5xx },
  ].filter((s) => s.count > 0)

  return {
    requestRate,
    errorStacked,
    latencyPercentiles,
    statusBreakdown,
    totalRequests,
    avgLatency,
    p99Latency,
    errorRatePercent,
  }
}

// Adapter to convert Recharts tooltip payload to our ChartTooltip props
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rechartsTooltipAdapter(props: any) {
  const mapped: TooltipPayload[] = (props.payload ?? []).map((p: any) => ({
    name: String(p.name ?? ''),
    value: Number(p.value ?? 0),
    color: String(p.color ?? p.fill ?? '#888'),
  }))
  return <ChartTooltip active={props.active} label={String(props.label ?? '')} payload={mapped} />
}

export const Route = createFileRoute('/traffic/analytics')({
  loader: ({ context }) => {
    const since = new Date(
      Date.now() - TIME_RANGE_MS['24h'],
    ).toISOString()
    const until = new Date().toISOString()
    return context.queryClient
      .ensureQueryData({
        queryKey: ['traffic', 'stats', '24h'],
        queryFn: () =>
          apiClient.get<TrafficStatsResponse>('/traffic/stats', {
            since,
            until,
            interval: TIME_RANGE_INTERVAL['24h'],
          }),
      })
      .catch(() => null)
  },
  component: TrafficAnalytics,
})

function TrafficAnalytics() {
  const { t } = useTranslation('traffic')
  const [timeRange, setTimeRange] = useState<TimeRange>('24h')

  const since = new Date(Date.now() - TIME_RANGE_MS[timeRange]).toISOString()
  const until = new Date().toISOString()

  const { data: rawStats, isLoading } = useQuery<TrafficStatsResponse>({
    queryKey: ['traffic', 'stats', timeRange],
    queryFn: () =>
      apiClient.get<TrafficStatsResponse>('/traffic/stats', {
        since,
        until,
        interval: TIME_RANGE_INTERVAL[timeRange],
      }),
    refetchInterval: 60000,
    retry: false,
  })

  const { data: topRoutesResp } = useQuery<TopRoutesResponse>({
    queryKey: ['traffic', 'stats', 'routes', timeRange],
    queryFn: () =>
      apiClient.get<TopRoutesResponse>('/traffic/stats/routes', {
        since,
        until,
      }),
    refetchInterval: 60000,
    retry: false,
  })

  const data = useMemo(
    () => (rawStats ? transformStats(rawStats) : undefined),
    [rawStats],
  )

  const topRoutes = topRoutesResp?.topRoutes ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('analytics.title')}
        description={t('analytics.subtitle')}
      />

      {/* Time range selector */}
      <Tabs
        value={timeRange}
        onValueChange={(v) => setTimeRange(v as TimeRange)}
      >
        <TabsList>
          <TabsTrigger value="1h">1h</TabsTrigger>
          <TabsTrigger value="6h">6h</TabsTrigger>
          <TabsTrigger value="24h">24h</TabsTrigger>
          <TabsTrigger value="7d">7d</TabsTrigger>
        </TabsList>

        {/* Use single content panel since all tabs render the same layout */}
        <TabsContent value={timeRange}>
          {/* Stat cards row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {isLoading ? (
              <>
                <Skeleton className="h-20 rounded-xl" />
                <Skeleton className="h-20 rounded-xl" />
                <Skeleton className="h-20 rounded-xl" />
                <Skeleton className="h-20 rounded-xl" />
              </>
            ) : (
              <>
                <StatCard
                  title={t('analytics.totalRequests')}
                  value={data?.totalRequests?.toLocaleString() ?? '0'}
                  icon={<Hash className="size-4" />}
                />
                <StatCard
                  title={t('analytics.avgLatency')}
                  value={data?.avgLatency != null ? `${data.avgLatency}ms` : '--'}
                  icon={<Clock className="size-4" />}
                />
                <StatCard
                  title={t('analytics.p99Latency')}
                  value={data?.p99Latency != null ? `${data.p99Latency}ms` : '--'}
                  icon={<Gauge className="size-4" />}
                />
                <StatCard
                  title={t('analytics.errorRateStat')}
                  value={
                    data?.errorRatePercent != null ? `${data.errorRatePercent.toFixed(2)}%` : '--'
                  }
                  icon={<AlertTriangle className="size-4" />}
                />
              </>
            )}
          </div>

          {/* Charts 2-col grid */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Request Rate */}
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.requestRate')}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-56 w-full" />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={224}>
                      <AreaChart data={data?.requestRate ?? []}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-border"
                        />
                        <XAxis
                          dataKey="time"
                          className="text-xs"
                          tick={{ fill: 'currentColor' }}
                        />
                        <YAxis
                          className="text-xs"
                          tick={{ fill: 'currentColor' }}
                        />
                        <RTooltip content={rechartsTooltipAdapter} />
                        <Area
                          type="monotone"
                          dataKey="requests"
                          stroke="#6366f1"
                          fill="rgba(99, 102, 241, 0.1)"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                    <TimezoneCaption />
                  </>
                )}
              </CardContent>
            </Card>

            {/* Error Rate — Stacked Bar */}
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.errorRate')}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-56 w-full" />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={224}>
                      <BarChart data={data?.errorStacked ?? []}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-border"
                        />
                        <XAxis
                          dataKey="time"
                          className="text-xs"
                          tick={{ fill: 'currentColor' }}
                        />
                        <YAxis
                          className="text-xs"
                          tick={{ fill: 'currentColor' }}
                        />
                        <RTooltip content={rechartsTooltipAdapter} />
                        <Legend />
                        {(Object.keys(ERROR_COLORS) as Array<keyof typeof ERROR_COLORS>).map(
                          (key) => (
                            <Bar
                              key={key}
                              dataKey={key}
                              stackId="errors"
                              fill={ERROR_COLORS[key]}
                            />
                          ),
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                    <TimezoneCaption />
                  </>
                )}
              </CardContent>
            </Card>

            {/* Latency Percentiles */}
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.latencyPercentiles', { defaultValue: 'Latency Percentiles' })}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-56 w-full" />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={224}>
                      <LineChart data={data?.latencyPercentiles ?? []}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-border"
                        />
                        <XAxis
                          dataKey="time"
                          className="text-xs"
                          tick={{ fill: 'currentColor' }}
                        />
                        <YAxis
                          className="text-xs"
                          tick={{ fill: 'currentColor' }}
                          unit="ms"
                        />
                        <RTooltip content={rechartsTooltipAdapter} />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="p50"
                          stroke={LATENCY_COLORS.p50}
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="p95"
                          stroke={LATENCY_COLORS.p95}
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="p99"
                          stroke={LATENCY_COLORS.p99}
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    <TimezoneCaption />
                  </>
                )}
              </CardContent>
            </Card>

            {/* Top Routes — Horizontal Bar */}
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.topRoutes')}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-56 w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={224}>
                    <BarChart
                      data={topRoutes}
                      layout="vertical"
                      margin={{ left: 80 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-border"
                      />
                      <XAxis
                        type="number"
                        className="text-xs"
                        tick={{ fill: 'currentColor' }}
                      />
                      <YAxis
                        type="category"
                        dataKey="route"
                        className="text-xs"
                        tick={{ fill: 'currentColor' }}
                        width={76}
                      />
                      <RTooltip content={rechartsTooltipAdapter} />
                      <Bar
                        dataKey="count"
                        fill="#6366f1"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Status Code Breakdown (donut) */}
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.statusBreakdown')}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-56 w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={224}>
                    <PieChart>
                      <Pie
                        data={data?.statusBreakdown ?? []}
                        dataKey="count"
                        nameKey="code"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {(data?.statusBreakdown ?? []).map((entry) => (
                          <Cell
                            key={entry.code}
                            fill={STATUS_COLORS[entry.code] ?? '#6b7280'}
                          />
                        ))}
                      </Pie>
                      <RTooltip content={rechartsTooltipAdapter} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
