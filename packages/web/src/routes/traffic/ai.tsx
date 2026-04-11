import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Sparkles, DollarSign, Radio, Layers } from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { StatCard } from '@/components/rioku/stat-card'
import { DataTable } from '@/components/rioku/data-table'
import { ChartTooltip, type TooltipPayload } from '@/components/rioku/chart-tooltip'
import { TimezoneCaption } from '@/components/rioku/timezone-caption'
import { StatusBadge, type Status } from '@/components/rioku/status-badge'
import { TimeAgo } from '@/components/rioku/time-ago'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { apiClient, type AgentSession } from '@/lib/api'
import { features } from '@/lib/feature-flags'

// API response shape from /api/v1/traffic/tokens (proto: TokenStats)
interface TokenBucket {
  bucketStart: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  requestCount: number
}

interface TokenTotals {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  requestCount: number
  budgetUsedPct: number
}

interface ModelBreakdownEntry {
  provider: string
  model: string
  totalTokens: number
  estimatedCostUsd: number
  requestCount: number
}

interface TokenStatsResponse {
  buckets: TokenBucket[]
  totals: TokenTotals
  modelBreakdown: ModelBreakdownEntry[]
}

// Internal shape consumed by the page
interface AiMetrics {
  totalTokens: number
  estimatedCost: number
  activeSessions: number
  modelsUsed: number
  models: Array<{
    model: string
    provider: string
    requests: number
    tokens: number
    cost: number
  }>
  tokenStacked: Array<{ time: string; input: number; output: number }>
  costOverTime: Array<{ time: string; cost: number }>
  costByModel: Array<{ model: string; cost: number }>
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function transformTokenStats(resp: TokenStatsResponse): AiMetrics {
  const totals = resp.totals ?? ({} as TokenTotals)
  const buckets = resp.buckets ?? []
  const breakdown = resp.modelBreakdown ?? []

  return {
    totalTokens: totals.totalTokens ?? 0,
    estimatedCost: totals.estimatedCostUsd ?? 0,
    activeSessions: 0,
    modelsUsed: breakdown.length,
    models: breakdown.map((m) => ({
      model: m.model,
      provider: m.provider,
      requests: m.requestCount ?? 0,
      tokens: m.totalTokens ?? 0,
      cost: m.estimatedCostUsd ?? 0,
    })),
    tokenStacked: buckets.map((b) => ({
      time: formatTime(b.bucketStart),
      input: b.inputTokens ?? 0,
      output: b.outputTokens ?? 0,
    })),
    costOverTime: buckets.map((b) => ({
      time: formatTime(b.bucketStart),
      cost: b.estimatedCostUsd ?? 0,
    })),
    costByModel: breakdown.map((m) => ({
      model: m.model,
      cost: m.estimatedCostUsd ?? 0,
    })),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rechartsTooltipAdapter(props: any) {
  const mapped: TooltipPayload[] = (props.payload ?? []).map((p: any) => ({
    name: String(p.name ?? ''),
    value: Number(p.value ?? 0),
    color: String(p.color ?? p.fill ?? '#888'),
  }))
  return <ChartTooltip active={props.active} label={String(props.label ?? '')} payload={mapped} />
}

const AI_STATS_RANGE_MS = 24 * 60 * 60 * 1000

export const Route = createFileRoute('/traffic/ai')({
  loader: ({ context }) => {
    const since = new Date(Date.now() - AI_STATS_RANGE_MS).toISOString()
    const until = new Date().toISOString()
    return context.queryClient
      .ensureQueryData({
        queryKey: ['traffic', 'tokens'],
        queryFn: () =>
          apiClient.get<TokenStatsResponse>('/traffic/tokens', {
            since,
            until,
            interval: 'hour',
          }),
      })
      .catch(() => null)
  },
  component: TrafficAI,
})

function sessionStatusToHealth(status: string): Status {
  switch (status) {
    case 'active': return 'healthy'
    case 'completed': return 'unknown'
    case 'error': return 'unhealthy'
    default: return 'unknown'
  }
}

function TrafficAI() {
  const { t } = useTranslation('traffic')

  const since = new Date(Date.now() - AI_STATS_RANGE_MS).toISOString()
  const until = new Date().toISOString()

  const { data: rawTokenStats, isLoading } = useQuery<TokenStatsResponse>({
    queryKey: ['traffic', 'tokens'],
    queryFn: () =>
      apiClient.get<TokenStatsResponse>('/traffic/tokens', {
        since,
        until,
        interval: 'hour',
      }),
    refetchInterval: 60000,
    retry: false,
  })

  const { data: sessions, isLoading: sessionsLoading } = useQuery<AgentSession[]>({
    queryKey: ['traffic', 'sessions'],
    queryFn: () => apiClient.get<AgentSession[]>('/traffic/sessions', { since, until }),
    enabled: features.agentSessions,
    refetchInterval: 60000,
    retry: false,
  })

  const data = useMemo(
    () => (rawTokenStats ? transformTokenStats(rawTokenStats) : undefined),
    [rawTokenStats],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('ai.title')}
        description={t('ai.subtitle')}
      />

      {/* Stat cards */}
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
              title={t('ai.totalTokens')}
              value={data?.totalTokens?.toLocaleString() ?? '0'}
              icon={<Sparkles className="size-4" />}
            />
            <StatCard
              title={t('ai.estimatedCost')}
              value={
                data?.estimatedCost != null ? `$${data.estimatedCost.toFixed(2)}` : '$0.00'
              }
              icon={<DollarSign className="size-4" />}
            />
            <StatCard
              title={t('ai.activeSessions')}
              value={String(data?.activeSessions ?? 0)}
              icon={<Radio className="size-4" />}
            />
            <StatCard
              title={t('ai.modelsUsed')}
              value={String(data?.modelsUsed ?? 0)}
              icon={<Layers className="size-4" />}
            />
          </>
        )}
      </div>

      {/* Placeholder note */}
      {!isLoading && !data && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t('ai.placeholderNote')}
        </div>
      )}

      {/* Model Breakdown table */}
      {isLoading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : (
        <DataTable
          title={t('ai.modelBreakdown')}
          columns={[
            {
              key: 'model',
              header: t('ai.model'),
              sortable: true,
              render: (row) => (
                <span className="font-mono">{row.model as string}</span>
              ),
            },
            { key: 'provider', header: t('ai.provider') },
            {
              key: 'requests',
              header: t('ai.requests'),
              sortable: true,
              render: (row) => (
                <span className="font-mono">
                  {(row.requests as number).toLocaleString()}
                </span>
              ),
            },
            {
              key: 'tokens',
              header: t('ai.tokens'),
              sortable: true,
              render: (row) => (
                <span className="font-mono">
                  {(row.tokens as number).toLocaleString()}
                </span>
              ),
            },
            {
              key: 'cost',
              header: t('ai.cost'),
              sortable: true,
              render: (row) => (
                <span className="font-mono">
                  {`$${(row.cost as number).toFixed(2)}`}
                </span>
              ),
            },
          ]}
          data={data?.models ?? []}
        />
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Token usage — stacked area (input vs output) */}
        <Card>
          <CardHeader>
            <CardTitle>{t('ai.tokenUsage')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={224}>
                  <AreaChart data={data?.tokenStacked ?? []}>
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
                    <Area
                      type="monotone"
                      dataKey="input"
                      stackId="tokens"
                      stroke="#8b5cf6"
                      fill="rgba(139, 92, 246, 0.3)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="output"
                      stackId="tokens"
                      stroke="#3b82f6"
                      fill="rgba(59, 130, 246, 0.3)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                <TimezoneCaption />
              </>
            )}
          </CardContent>
        </Card>

        {/* Cost over time */}
        <Card>
          <CardHeader>
            <CardTitle>{t('ai.costOverTime', { defaultValue: 'Cost Over Time' })}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={224}>
                  <AreaChart data={data?.costOverTime ?? []}>
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
                      tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                    />
                    <RTooltip content={rechartsTooltipAdapter} />
                    <Area
                      type="monotone"
                      dataKey="cost"
                      stroke="#22c55e"
                      fill="rgba(34, 197, 94, 0.1)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                <TimezoneCaption />
              </>
            )}
          </CardContent>
        </Card>

        {/* Cost by model — horizontal bar */}
        <Card>
          <CardHeader>
            <CardTitle>{t('ai.costByModel')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={224}>
                <BarChart
                  data={data?.costByModel ?? []}
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
                    tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="model"
                    className="text-xs"
                    tick={{ fill: 'currentColor' }}
                    width={76}
                  />
                  <RTooltip content={rechartsTooltipAdapter} />
                  <Bar
                    dataKey="cost"
                    fill="#8b5cf6"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agent Sessions table (behind feature flag) */}
      {features.agentSessions && (
        <>
          {sessionsLoading ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : (
            <DataTable
              title="Agent Sessions"
              columns={[
                {
                  key: 'sessionId',
                  header: 'Session ID',
                  render: (row) => (
                    <span className="max-w-32 truncate font-mono text-xs text-primary">
                      {row.sessionId as string}
                    </span>
                  ),
                },
                {
                  key: 'agentIdentity',
                  header: 'Agent',
                },
                {
                  key: 'turns',
                  header: 'Turns',
                  sortable: true,
                  render: (row) => (
                    <span className="font-mono">{(row.turns as number).toLocaleString()}</span>
                  ),
                },
                {
                  key: 'totalTokens',
                  header: 'Tokens',
                  sortable: true,
                  render: (row) => (
                    <span className="font-mono">{(row.totalTokens as number).toLocaleString()}</span>
                  ),
                },
                {
                  key: 'estimatedCostUsd',
                  header: 'Cost',
                  sortable: true,
                  render: (row) => (
                    <span className="font-mono">{`$${(row.estimatedCostUsd as number).toFixed(2)}`}</span>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (row) => (
                    <StatusBadge status={sessionStatusToHealth(row.status as string)} />
                  ),
                },
                {
                  key: 'startedAt',
                  header: 'Started',
                  render: (row) => <TimeAgo date={row.startedAt as string} />,
                },
                {
                  key: 'lastActivityAt',
                  header: 'Last Activity',
                  render: (row) => <TimeAgo date={row.lastActivityAt as string} />,
                },
              ]}
              data={(sessions ?? []) as unknown as Record<string, unknown>[]}
              searchable
              searchPlaceholder="Search sessions..."
              pageSize={20}
            />
          )}
        </>
      )}
    </div>
  )
}
