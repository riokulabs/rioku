import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface RecentRequest {
  time: string
  method: string
  path: string
  status: number
  latencyMs: number
}

interface TrafficTabData {
  rps: number
  rpsDelta?: string
  errorRate: number
  errorCount: number
  totalRequests: number
  p95LatencyMs: number
  p50LatencyMs?: number
  bandwidth?: string
  activeConnections?: number
  upstreamCount?: number
  requestRateData: { time: string; rps: number }[]
  errorBreakdownData: { time: string; '4xx': number; '5xx': number }[]
  recentRequests: RecentRequest[]
}

type EntityType = 'route' | 'service' | 'global'

interface TrafficTabDataProps {
  data: TrafficTabData | null
  isLoading?: boolean
}

interface TrafficTabEntityProps {
  entityType: EntityType
  entityId: string
}

type TrafficTabProps = TrafficTabDataProps | TrafficTabEntityProps

function isEntityProps(props: TrafficTabProps): props is TrafficTabEntityProps {
  return 'entityType' in props
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-blue-400',
  POST: 'text-green-400',
  PUT: 'text-yellow-400',
  PATCH: 'text-yellow-400',
  DELETE: 'text-red-400',
}

function StatusColor({ status }: { status: number }) {
  const color = status >= 200 && status < 300
    ? 'text-green-500'
    : status >= 400 && status < 500
      ? 'text-amber-500'
      : status >= 500
        ? 'text-red-500'
        : 'text-foreground'
  return <span className={cn('font-mono text-sm font-medium', color)}>{status}</span>
}

function TrafficTab(props: TrafficTabProps) {
  const entityQuery = useQuery({
    queryKey: ['traffic', isEntityProps(props) ? props.entityType : '', isEntityProps(props) ? props.entityId : ''],
    queryFn: () => apiClient.get<TrafficTabData>(`/traffic/${(props as TrafficTabEntityProps).entityType}s/${(props as TrafficTabEntityProps).entityId}`),
    enabled: isEntityProps(props),
  })

  const data = isEntityProps(props) ? (entityQuery.data ?? null) : props.data
  const isLoading = isEntityProps(props) ? entityQuery.isLoading : (props.isLoading ?? false)

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <p className="sr-only">Loading traffic data...</p>
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="gap-0 py-0">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">RPS</p>
            <p className="mt-1 text-2xl font-bold">{data.rps}</p>
            {data.rpsDelta && (
              <p className="mt-1 text-xs text-green-500">{data.rpsDelta} vs last hour</p>
            )}
          </CardContent>
        </Card>
        <Card className="gap-0 py-0">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Error Rate</p>
            <p className={cn('mt-1 text-2xl font-bold', data.errorRate < 1 ? 'text-green-500' : 'text-red-500')}>
              {data.errorRate}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.errorCount} errors / {data.totalRequests.toLocaleString()} total
            </p>
          </CardContent>
        </Card>
        <Card className="gap-0 py-0">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">P95 Latency</p>
            <p className="mt-1 text-2xl font-bold">{data.p95LatencyMs}ms</p>
            {data.p50LatencyMs != null && (
              <p className="mt-1 text-xs text-muted-foreground">P50: {data.p50LatencyMs}ms</p>
            )}
          </CardContent>
        </Card>
        <Card className="gap-0 py-0">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">
              {data.bandwidth ? 'Bandwidth' : 'Active Connections'}
            </p>
            <p className="mt-1 text-2xl font-bold">
              {data.bandwidth ?? data.activeConnections ?? '--'}
            </p>
            {data.upstreamCount != null && (
              <p className="mt-1 text-xs text-muted-foreground">across {data.upstreamCount} upstreams</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Request Rate chart */}
      {data.requestRateData.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Request Rate (last 1h)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={192}>
              <BarChart data={data.requestRateData} barCategoryGap={1}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} interval={7} />
                <YAxis className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #333', borderRadius: '8px', color: '#e5e5e5' }} />
                <Bar dataKey="rps" fill="#6366f1" radius={[2, 2, 0, 0]} name="RPS" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Error breakdown chart */}
      {data.errorBreakdownData.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Error Breakdown</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={data.errorBreakdownData} barCategoryGap={2}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" hide />
                <YAxis className="text-xs fill-muted-foreground" tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #333', borderRadius: '8px', color: '#e5e5e5' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="4xx" stackId="errors" fill="#f59e0b" opacity={0.8} name="4xx" />
                <Bar dataKey="5xx" stackId="errors" fill="#ef4444" radius={[2, 2, 0, 0]} name="5xx" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent requests table */}
      {data.recentRequests.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Recent Requests</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Time</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Method</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Path</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.recentRequests.map((req, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">{req.time}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('font-mono font-medium', METHOD_COLORS[req.method] ?? 'text-foreground')}>
                        {req.method}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono">{req.path}</td>
                    <td className="px-4 py-2.5"><StatusColor status={req.status} /></td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-muted-foreground">{req.latencyMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export { TrafficTab }
export type { TrafficTabProps, TrafficTabData }
