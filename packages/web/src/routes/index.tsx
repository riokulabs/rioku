import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Clock,
  Route as RouteIcon,
  User,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { HealthStatus, ConfigSnapshot, AuditEntry } from '@/lib/api'

import { PageHeader } from '@/components/rioku/page-header'
import { StaleIndicator } from '@/components/rioku/stale-indicator'
import { StatCard } from '@/components/rioku/stat-card'
import { StatusBadge } from '@/components/rioku/status-badge'
import type { Status } from '@/components/rioku/status-badge'
import { TimeAgo } from '@/components/rioku/time-ago'
import { TimeRangeSelector } from '@/components/rioku/time-range-selector'
import { useTimeRange } from '@/hooks/use-time-range'
import { Slot } from '@/components/plugin/slot'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card'

export const Route = createFileRoute('/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient
        .ensureQueryData({
          queryKey: ['health'],
          queryFn: () => apiClient.get<HealthStatus>('/health'),
        })
        .catch(() => null as HealthStatus | null),
      context.queryClient
        .ensureQueryData({
          queryKey: ['config'],
          queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
        })
        .catch(() => null as ConfigSnapshot | null),
      context.queryClient
        .ensureQueryData({
          queryKey: ['audit', 'recent'],
          queryFn: () => apiClient.get<AuditEntry[]>('/audit?limit=5'),
        })
        .catch(() => [] as AuditEntry[]),
    ]),
  component: Dashboard,
})

// ---------------------------------------------------------------------------
// Dashboard traffic data response shape (from /api/v1/traffic/dashboard)
// ---------------------------------------------------------------------------

interface DashboardSummary {
  totalRequests: number
  errorRate: number
  p95Latency: number
  activeRoutes: number
  disabledRoutes: number
  requestsDelta: string
  errorDelta: string
  latencyDelta: string
}

interface RequestRatePoint {
  time: string
  requests: number
}

interface ErrorRatePoint {
  time: string
  e4xx: number
  e502: number
  e503: number
  e429: number
  e5xx_other: number
}

interface LatencyPoint {
  time: string
  p50: number
  p95: number
  p99: number
}

interface TopRoutePoint {
  route: string
  requests: number
}

interface DashboardTrafficData {
  requestRateData: RequestRatePoint[]
  errorRateData: ErrorRatePoint[]
  latencyData: LatencyPoint[]
  topRoutesData: TopRoutePoint[]
  summary: DashboardSummary
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeStatus(raw: string | undefined): Status {
  if (!raw) return 'unknown'
  const lower = raw.toLowerCase()
  if (lower === 'healthy' || lower === 'ok') return 'healthy'
  if (lower === 'degraded') return 'degraded'
  if (lower === 'unhealthy' || lower === 'error') return 'unhealthy'
  return 'unknown'
}

function formatUptime(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null) return '--'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ChartPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex h-55 items-center justify-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard() {
  const { t } = useTranslation('dashboard')
  const [health, config, audit] = Route.useLoaderData()
  const { range, setRange } = useTimeRange()
  const queryClient = useQueryClient()
  const dashboardQueryState = queryClient.getQueryState(['traffic', 'dashboard', range])
  const dashboardUpdatedAt = dashboardQueryState?.dataUpdatedAt ?? Date.now()

  const { data: dashboardData } = useQuery<DashboardTrafficData>({
    queryKey: ['traffic', 'dashboard', range],
    queryFn: () =>
      apiClient.get<DashboardTrafficData>('/traffic/dashboard', { range }),
    refetchInterval: 60000,
    retry: false,
  })

  const {
    requestRateData = [],
    errorRateData = [],
    latencyData = [],
    topRoutesData = [],
    summary,
  } = dashboardData ?? {}

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader
          title={t('title', 'Dashboard')}
          description={t('description', 'Gateway performance at a glance')}
          actions={<TimeRangeSelector range={range} onChange={setRange} />}
        />
        <StaleIndicator
          dataUpdatedAt={dashboardUpdatedAt}
          onRefresh={() => {
            queryClient.invalidateQueries({ queryKey: ['traffic', 'dashboard'] })
            queryClient.invalidateQueries({ queryKey: ['health'] })
            queryClient.invalidateQueries({ queryKey: ['config'] })
          }}
        />
      </div>

      {/* Plugin alert zone */}
      <Slot zone="dashboard.alerts" />

      {/* ----------------------------------------------------------------- */}
      {/* Top row: Traffic stat cards with deltas                            */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title={t('stats.totalRequests', 'Total Requests')}
          value={summary?.totalRequests?.toLocaleString() ?? '--'}
          icon={<Activity className="size-5" />}
          trend={
            summary?.requestsDelta
              ? {
                  value: summary.requestsDelta,
                  direction: summary.requestsDelta.startsWith('+')
                    ? 'up'
                    : 'down',
                }
              : undefined
          }
        />
        <StatCard
          title={t('stats.errorRate', 'Error Rate')}
          value={summary?.errorRate != null ? `${summary.errorRate}%` : '--'}
          icon={<AlertTriangle className="size-5" />}
          trend={
            summary?.errorDelta
              ? {
                  value: summary.errorDelta,
                  direction: summary.errorDelta.startsWith('-')
                    ? 'up'
                    : 'down',
                }
              : undefined
          }
        />
        <StatCard
          title={t('stats.p95Latency', 'P95 Latency')}
          value={
            summary?.p95Latency != null ? `${summary.p95Latency}ms` : '--'
          }
          icon={<Clock className="size-5" />}
          trend={
            summary?.latencyDelta
              ? {
                  value: summary.latencyDelta,
                  direction: summary.latencyDelta.startsWith('-')
                    ? 'up'
                    : 'down',
                }
              : undefined
          }
        />
        <StatCard
          title={t('stats.activeRoutes', 'Active Routes')}
          value={summary?.activeRoutes ?? config?.routes.length ?? 0}
          icon={<RouteIcon className="size-5" />}
          trend={
            summary?.disabledRoutes
              ? {
                  value: `${summary.disabledRoutes} disabled`,
                  direction: 'down',
                }
              : undefined
          }
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Row 1: Request Rate (area) + Error Rate (stacked bar)             */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Request Rate AreaChart */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t('charts.requestRate', 'Request Rate')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {requestRateData.length === 0 ? (
              <ChartPlaceholder
                message={t('charts.noTrafficData', 'No traffic data')}
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={requestRateData}>
                  <defs>
                    <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="#6366f1"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="100%"
                        stopColor="#6366f1"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                  />
                  <XAxis
                    dataKey="time"
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #333', borderRadius: '8px', color: '#e5e5e5' }} />
                  <Area
                    type="monotone"
                    dataKey="requests"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#reqGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Error Rate Stacked BarChart */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t('charts.errorRate', 'Error Rate')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {errorRateData.length === 0 ? (
              <ChartPlaceholder
                message={t('charts.noErrorData', 'No error data')}
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={errorRateData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                  />
                  <XAxis
                    dataKey="time"
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #333', borderRadius: '8px', color: '#e5e5e5' }} />
                  <Bar
                    dataKey="e4xx"
                    stackId="errors"
                    fill="#f59e0b"
                    name="4xx"
                  />
                  <Bar
                    dataKey="e502"
                    stackId="errors"
                    fill="#dc2626"
                    name="502"
                  />
                  <Bar
                    dataKey="e503"
                    stackId="errors"
                    fill="#ea580c"
                    name="503"
                  />
                  <Bar
                    dataKey="e429"
                    stackId="errors"
                    fill="#a855f7"
                    name="429"
                  />
                  <Bar
                    dataKey="e5xx_other"
                    stackId="errors"
                    fill="#ef4444"
                    name="5xx Other"
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Row 2: Latency Percentiles (line) + Top Routes (horizontal bar)   */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Latency Percentiles LineChart */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t('charts.latencyPercentiles', 'Latency Percentiles')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latencyData.length === 0 ? (
              <ChartPlaceholder
                message={t('charts.noLatencyData', 'No latency data')}
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={latencyData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                  />
                  <XAxis
                    dataKey="time"
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v}ms`}
                  />
                  <Tooltip contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #333', borderRadius: '8px', color: '#e5e5e5' }} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconType="line"
                    iconSize={12}
                    wrapperStyle={{ fontSize: '11px', paddingBottom: '8px' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="p50"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={false}
                    name="p50"
                  />
                  <Line
                    type="monotone"
                    dataKey="p95"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                    name="p95"
                  />
                  <Line
                    type="monotone"
                    dataKey="p99"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={false}
                    name="p99"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top Routes horizontal BarChart */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t('charts.topRoutes', 'Top Routes by Traffic')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topRoutesData.length === 0 ? (
              <ChartPlaceholder
                message={t('charts.noRouteData', 'No route data')}
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={topRoutesData}
                  layout="vertical"
                  margin={{ left: 20 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      `${(v / 1000).toFixed(0)}k`
                    }
                  />
                  <YAxis
                    dataKey="route"
                    type="category"
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    width={130}
                  />
                  <Tooltip contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #333', borderRadius: '8px', color: '#e5e5e5' }} />
                  <Bar
                    dataKey="requests"
                    fill="#6366f1"
                    radius={[0, 4, 4, 0]}
                    barSize={16}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Bottom row: System Status + Recent Changes                        */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent changes */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t('recentChanges.title', 'Recent Changes')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!audit || audit.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('recentChanges.empty', 'No recent changes')}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {audit.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <User className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className="font-medium">{entry.actor}</span>{' '}
                        <span className="text-muted-foreground">
                          {entry.operation}
                        </span>{' '}
                        <span className="font-mono text-xs">
                          {entry.entityType}/{entry.entityId}
                        </span>
                      </p>
                      <TimeAgo date={entry.occurredAt} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* System status */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t('systemStatus.title', 'System Status')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <div className="flex items-center justify-between">
                <dt className="text-sm text-muted-foreground">
                  {t('systemStatus.storeHealth', 'Store Health')}
                </dt>
                <dd>
                  <StatusBadge
                    status={normalizeStatus(health?.store.status)}
                    label={health?.store.status}
                  />
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-sm text-muted-foreground">
                  {t('systemStatus.caddyStatus', 'Caddy Status')}
                </dt>
                <dd>
                  <StatusBadge
                    status={normalizeStatus(health?.caddy.status)}
                    label={health?.caddy.status}
                  />
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-sm text-muted-foreground">
                  {t('systemStatus.version', 'Version')}
                </dt>
                <dd className="font-mono text-sm">
                  {health?.version ?? '--'}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-sm text-muted-foreground">
                  {t('systemStatus.uptime', 'Uptime')}
                </dt>
                <dd className="font-mono text-sm">
                  {formatUptime(health?.uptimeSeconds)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Plugin widget zone */}
      <Slot zone="dashboard.widgets" />
    </div>
  )
}
