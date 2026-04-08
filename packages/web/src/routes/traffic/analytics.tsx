import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
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
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { apiClient } from '@/lib/api'

type TimeRange = '1h' | '6h' | '24h' | '7d'

// Placeholder data structures for when the API exists
interface AnalyticsData {
  requestRate: Array<{ time: string; requests: number }>
  errorRate: Array<{ time: string; errors: number }>
  topRoutes: Array<{ route: string; count: number }>
  statusBreakdown: Array<{ code: string; count: number }>
  totalRequests: number
  avgLatency: number
  p99Latency: number
  errorRatePercent: number
}

export const Route = createFileRoute('/traffic/analytics')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['traffic', 'analytics', '24h'],
        queryFn: () =>
          apiClient.get<AnalyticsData>('/traffic/analytics', { range: '24h' }),
      })
      .catch(() => null),
  component: TrafficAnalytics,
})

const STATUS_COLORS = ['#22c55e', '#3b82f6', '#eab308', '#ef4444']

function TrafficAnalytics() {
  const { t } = useTranslation('traffic')
  const [timeRange, setTimeRange] = useState<TimeRange>('24h')

  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ['traffic', 'analytics', timeRange],
    queryFn: () =>
      apiClient.get<AnalyticsData>('/traffic/analytics', { range: timeRange }),
    retry: false,
  })

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
                      <RTooltip />
                      <Area
                        type="monotone"
                        dataKey="requests"
                        stroke="hsl(var(--primary))"
                        fill="hsl(var(--primary) / 0.1)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Error Rate */}
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.errorRate')}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-56 w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={224}>
                    <AreaChart data={data?.errorRate ?? []}>
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
                      <RTooltip />
                      <Area
                        type="monotone"
                        dataKey="errors"
                        stroke="hsl(var(--destructive))"
                        fill="hsl(var(--destructive) / 0.1)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Top Routes */}
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
                      data={data?.topRoutes ?? []}
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
                      />
                      <RTooltip />
                      <Bar
                        dataKey="count"
                        fill="hsl(var(--primary))"
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
                        {(data?.statusBreakdown ?? []).map((_, i) => (
                          <Cell
                            key={i}
                            fill={STATUS_COLORS[i % STATUS_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <RTooltip />
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
