import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart,
  Area,
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
import { Sparkles, DollarSign, Radio, Layers } from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { StatCard } from '@/components/rioku/stat-card'
import { DataTable } from '@/components/rioku/data-table'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { apiClient } from '@/lib/api'

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
  tokenUsageOverTime: Array<{ time: string; tokens: number }>
  costByModel: Array<{ model: string; cost: number }>
}

export const Route = createFileRoute('/traffic/ai')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['traffic', 'ai'],
      queryFn: () => apiClient.get<AiMetrics>('/traffic/ai'),
    }),
  component: TrafficAI,
})

const MODEL_COLORS = [
  '#8b5cf6',
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#ef4444',
  '#ec4899',
]

function TrafficAI() {
  const { t } = useTranslation('traffic')

  const { data, isLoading } = useQuery<AiMetrics>({
    queryKey: ['traffic', 'ai'],
    queryFn: () => apiClient.get<AiMetrics>('/traffic/ai'),
    retry: false,
  })

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
                data ? `$${data.estimatedCost.toFixed(2)}` : '$0.00'
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
              render: (row) => (
                <span className="font-mono">{row.model as string}</span>
              ),
            },
            { key: 'provider', header: t('ai.provider') },
            {
              key: 'requests',
              header: t('ai.requests'),
              render: (row) => (
                <span className="font-mono">
                  {(row.requests as number).toLocaleString()}
                </span>
              ),
            },
            {
              key: 'tokens',
              header: t('ai.tokens'),
              render: (row) => (
                <span className="font-mono">
                  {(row.tokens as number).toLocaleString()}
                </span>
              ),
            },
            {
              key: 'cost',
              header: t('ai.cost'),
              render: (row) => (
                <span className="font-mono">
                  ${(row.cost as number).toFixed(2)}
                </span>
              ),
            },
          ]}
          data={data?.models ?? []}
        />
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Token usage over time */}
        <Card>
          <CardHeader>
            <CardTitle>{t('ai.tokenUsage')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={224}>
                <AreaChart data={data?.tokenUsageOverTime ?? []}>
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
                    dataKey="tokens"
                    stroke="#8b5cf6"
                    fill="rgba(139, 92, 246, 0.1)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Cost by model */}
        <Card>
          <CardHeader>
            <CardTitle>{t('ai.costByModel')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={224}>
                <PieChart>
                  <Pie
                    data={data?.costByModel ?? []}
                    dataKey="cost"
                    nameKey="model"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {(data?.costByModel ?? []).map((_, i) => (
                      <Cell
                        key={i}
                        fill={MODEL_COLORS[i % MODEL_COLORS.length]}
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
    </div>
  )
}
