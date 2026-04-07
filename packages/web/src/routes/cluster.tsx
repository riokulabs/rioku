import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Server, ChevronDown, ChevronUp, Crown } from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { StatCard } from '@/components/rioku/stat-card'
import { StatusBadge, type Status } from '@/components/rioku/status-badge'
import { TimeAgo } from '@/components/rioku/time-ago'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardAction,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { apiClient, type HealthStatus } from '@/lib/api'

export const Route = createFileRoute('/cluster')({
  component: Cluster,
})

interface NodeInfo {
  name: string
  role: 'bootstrap' | 'member'
  health: Status
  daemon_version: string
  caddy_version: string
  store_mode: string
  last_seen: string
}

interface ClusterData {
  nodes: NodeInfo[]
  raft_leader?: string
}

function Cluster() {
  const { t } = useTranslation('cluster')

  const { data, isLoading } = useQuery<ClusterData>({
    queryKey: ['cluster'],
    queryFn: () => apiClient.get<ClusterData>('/cluster'),
    retry: false,
  })

  const nodes = data?.nodes ?? []
  const isSingleNode = nodes.length <= 1

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {/* Cluster overview stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <>
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </>
        ) : (
          <>
            <StatCard
              title={t('nodeCount')}
              value={String(nodes.length)}
              icon={<Server className="size-4" />}
            />
            {data?.raft_leader && (
              <StatCard
                title={t('raftLeader')}
                value={data.raft_leader}
                icon={<Crown className="size-4" />}
              />
            )}
          </>
        )}
      </div>

      {/* Single node notice */}
      {!isLoading && isSingleNode && (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t('singleNodeNote')}
        </div>
      )}

      {/* Node cards grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {nodes.map((node) => (
            <NodeCard key={node.name} node={node} />
          ))}
        </div>
      )}
    </div>
  )
}

function NodeCard({ node }: { node: NodeInfo }) {
  const { t } = useTranslation('cluster')
  const [expanded, setExpanded] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="size-4 text-muted-foreground" />
          <span className="font-mono">{node.name}</span>
        </CardTitle>
        <CardAction>
          <div className="flex items-center gap-2">
            <Badge
              variant={
                node.role === 'bootstrap' ? 'default' : 'secondary'
              }
            >
              {t(`roles.${node.role}`)}
            </Badge>
            <StatusBadge status={node.health} />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-muted-foreground">
            {t('labels.daemonVersion')}
          </span>
          <span className="font-mono">{node.daemon_version}</span>

          <span className="text-muted-foreground">
            {t('labels.caddyVersion')}
          </span>
          <span className="font-mono">{node.caddy_version}</span>

          <span className="text-muted-foreground">
            {t('labels.lastSeen')}
          </span>
          <TimeAgo date={node.last_seen} />
        </div>

        {/* Expandable detail section */}
        {expanded && (
          <div className="grid grid-cols-2 gap-y-2 border-t pt-3 text-sm">
            <span className="text-muted-foreground">
              {t('labels.storeMode')}
            </span>
            <span>{node.store_mode}</span>

            <span className="text-muted-foreground">
              {t('labels.health')}
            </span>
            <StatusBadge status={node.health} />
          </div>
        )}

        <Button
          variant="ghost"
          size="xs"
          className="w-full"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? (
            <ChevronUp className="size-3.5" data-icon="inline-start" />
          ) : (
            <ChevronDown className="size-3.5" data-icon="inline-start" />
          )}
          {expanded ? 'Less' : 'More'}
        </Button>
      </CardContent>
    </Card>
  )
}
