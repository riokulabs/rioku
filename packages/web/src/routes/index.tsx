import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Route as RouteIcon,
  Server,
  Database,
  Hexagon,
  User,
  AlertCircle,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

import { apiClient } from '@/lib/api'
import type { HealthStatus, ConfigSnapshot, AuditEntry } from '@/lib/api'

import { PageHeader } from '@/components/rioku/page-header'
import { StatCard } from '@/components/rioku/stat-card'
import { StatusBadge } from '@/components/rioku/status-badge'
import type { Status } from '@/components/rioku/status-badge'
import { TimeAgo } from '@/components/rioku/time-ago'
import { Slot } from '@/components/plugin/slot'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card'

export const Route = createFileRoute('/')({
  component: Dashboard,
})

// ---------------------------------------------------------------------------
// Placeholder chart data (proper shape for when the API connects)
// ---------------------------------------------------------------------------

const trafficPlaceholder: { time: string; requests: number; errors: number }[] =
  []

const latencyPlaceholder: {
  bin: string
  count: number
}[] = []

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

function StatCardSkeleton() {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center gap-4 px-4 py-4">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-16" />
        </div>
      </div>
    </Card>
  )
}

function ChartPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="size-4 shrink-0" />
      {message}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard() {
  const { t } = useTranslation('dashboard')

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.get<HealthStatus>('/health'),
  })

  const configQuery = useQuery({
    queryKey: ['config'],
    queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
  })

  const auditQuery = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => apiClient.get<AuditEntry[]>('/audit?limit=5'),
  })

  const health = healthQuery.data
  const config = configQuery.data
  const audit = auditQuery.data

  const trafficData = trafficPlaceholder
  const latencyData = latencyPlaceholder

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title', 'Dashboard')}
        description={t('description', 'Overview of your API gateway')}
      />

      {/* Plugin alert zone */}
      <Slot zone="dashboard.alerts" />

      {/* ----------------------------------------------------------------- */}
      {/* Top row: Stat cards                                                */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {configQuery.isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : configQuery.isError ? (
          <>
            <StatCard
              title={t('stats.totalRoutes', 'Total Routes')}
              value="--"
              icon={<RouteIcon className="size-5" />}
            />
            <StatCard
              title={t('stats.activeServices', 'Active Services')}
              value="--"
              icon={<Server className="size-5" />}
            />
          </>
        ) : (
          <>
            <StatCard
              title={t('stats.totalRoutes', 'Total Routes')}
              value={config?.routes.length ?? 0}
              icon={<RouteIcon className="size-5" />}
            />
            <StatCard
              title={t('stats.activeServices', 'Active Services')}
              value={config?.services.length ?? 0}
              icon={<Server className="size-5" />}
            />
          </>
        )}

        {healthQuery.isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : healthQuery.isError ? (
          <>
            <StatCard
              title={t('stats.storeHealth', 'Store Health')}
              value={
                <StatusBadge status="unknown" label={t('status.unknown', 'Unknown')} />
              }
              icon={<Database className="size-5" />}
            />
            <StatCard
              title={t('stats.version', 'Version')}
              value="--"
              icon={<Hexagon className="size-5" />}
            />
          </>
        ) : (
          <>
            <StatCard
              title={t('stats.storeHealth', 'Store Health')}
              value={
                <StatusBadge
                  status={normalizeStatus(health?.store.status)}
                  label={health?.store.status ?? t('status.unknown', 'Unknown')}
                />
              }
              icon={<Database className="size-5" />}
            />
            <StatCard
              title={t('stats.version', 'Version')}
              value={health?.version ?? '--'}
              icon={<Hexagon className="size-5" />}
            />
          </>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Middle row: Charts                                                 */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Traffic overview */}
        <Card>
          <CardHeader>
            <CardTitle>{t('charts.trafficOverview', 'Traffic Overview')}</CardTitle>
          </CardHeader>
          <CardContent>
            {trafficData.length === 0 ? (
              <ChartPlaceholder
                message={t(
                  'charts.noTrafficData',
                  'No traffic data available yet',
                )}
              />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart
                  data={trafficData}
                  margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                  />
                  <XAxis
                    dataKey="time"
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="requests"
                    stackId="1"
                    className="fill-primary/20 stroke-primary"
                  />
                  <Area
                    type="monotone"
                    dataKey="errors"
                    stackId="2"
                    className="fill-destructive/20 stroke-destructive"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Response latency */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t('charts.responseLatency', 'Response Latency')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latencyData.length === 0 ? (
              <ChartPlaceholder
                message={t(
                  'charts.noLatencyData',
                  'No latency data available yet',
                )}
              />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={latencyData}
                  margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                  />
                  <XAxis
                    dataKey="bin"
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    className="text-xs fill-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip />
                  <Bar
                    dataKey="count"
                    className="fill-primary"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Bottom row: Info cards                                             */}
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
            {auditQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="size-8 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : auditQuery.isError ? (
              <ErrorCard
                message={t(
                  'recentChanges.error',
                  'Failed to load recent changes',
                )}
              />
            ) : !audit || audit.length === 0 ? (
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
                          {entry.entity_type}/{entry.entity_id}
                        </span>
                      </p>
                      <TimeAgo date={entry.timestamp} />
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
            {healthQuery.isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                ))}
              </div>
            ) : healthQuery.isError ? (
              <ErrorCard
                message={t(
                  'systemStatus.error',
                  'Failed to load system status',
                )}
              />
            ) : (
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
                  <dd className="text-sm font-mono">
                    {health?.version ?? '--'}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-muted-foreground">
                    {t('systemStatus.uptime', 'Uptime')}
                  </dt>
                  <dd className="text-sm font-mono">
                    {formatUptime(health?.uptime)}
                  </dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Plugin widget zone */}
      <Slot zone="dashboard.widgets" />
    </div>
  )
}
