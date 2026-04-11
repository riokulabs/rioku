import { useState, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Server, ChevronDown, ChevronUp, Crown, RefreshCw, Trash2 } from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { StatCard } from '@/components/rioku/stat-card'
import { StatusBadge, type Status } from '@/components/rioku/status-badge'
import { TimeAgo } from '@/components/rioku/time-ago'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardAction,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { apiClient, type NodeDetail, type NodeMetrics, type NodeCertStatus, type SyncEvent } from '@/lib/api'

interface ClusterData {
  nodes: NodeDetail[]
  raft_leader?: string
}

export const Route = createFileRoute('/cluster')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['cluster'],
        queryFn: () => apiClient.get<ClusterData>('/cluster'),
      })
      .catch(() => ({ nodes: [] }) as ClusterData),
  component: Cluster,
})

function certStatusColor(status: string): Status {
  switch (status) {
    case 'valid': return 'healthy'
    case 'expiring': return 'degraded'
    case 'expired': return 'unhealthy'
    default: return 'unknown'
  }
}

function syncTypeBadgeColor(type: string): string {
  switch (type) {
    case 'config_push': return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-transparent'
    case 'config_pull': return 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-transparent'
    case 'cert_sync': return 'bg-green-500/10 text-green-700 dark:text-green-400 border-transparent'
    case 'health_check': return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-transparent'
    default: return ''
  }
}

function Cluster() {
  const { t } = useTranslation('cluster')
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<ClusterData>({
    queryKey: ['cluster'],
    queryFn: () => apiClient.get<ClusterData>('/cluster'),
    refetchInterval: 30000,
  })

  const nodes = data?.nodes ?? []
  const isSingleNode = nodes.length <= 1

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['cluster'] })}
          >
            <RefreshCw className="size-3.5" data-icon="inline-start" />
            {t('actions.refresh', { defaultValue: 'Refresh' })}
          </Button>
        }
      />

      {/* Cluster overview stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
      </div>

      {/* Single node notice */}
      {isSingleNode && (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t('singleNodeNote')}
        </div>
      )}

      {/* Node cards grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {nodes.map((node) => (
          <NodeCard key={node.name} node={node} />
        ))}
      </div>
    </div>
  )
}

function NodeCard({ node }: { node: NodeDetail }) {
  const { t } = useTranslation('cluster')
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const removeMutation = useMutation({
    mutationFn: () => apiClient.del(`/cluster/nodes/${node.name}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cluster'] }),
  })

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
            <StatusBadge status={node.health as Status} />
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
          <div className="space-y-4 border-t pt-3">
            {/* Basic info */}
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-muted-foreground">
                {t('labels.storeMode')}
              </span>
              <span>{node.store_mode}</span>

              {node.address && (
                <>
                  <span className="text-muted-foreground">Address</span>
                  <span className="font-mono text-xs">{node.address}</span>
                </>
              )}

              <span className="text-muted-foreground">
                {t('labels.health')}
              </span>
              <StatusBadge status={node.health as Status} />
            </div>

            {/* Metrics */}
            {node.metrics && <MetricsSection metrics={node.metrics} />}

            {/* Certificate status */}
            {node.certificates && node.certificates.length > 0 && (
              <CertificatesSection certificates={node.certificates} />
            )}

            {/* Recent sync events */}
            {node.recentSyncEvents && node.recentSyncEvents.length > 0 && (
              <SyncEventsSection events={node.recentSyncEvents.slice(0, 5)} />
            )}

            {/* Remove node button (non-bootstrap only) */}
            {node.role !== 'bootstrap' && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 className="size-3.5" data-icon="inline-start" />
                Remove node
              </Button>
            )}
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

      {confirmRemove && (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setConfirmRemove(false) }}
          title="Remove Node"
          description={`Remove node ${node.name} from the cluster? This cannot be undone.`}
          confirmLabel="Remove"
          variant="destructive"
          onConfirm={() => {
            removeMutation.mutate()
            setConfirmRemove(false)
          }}
        />
      )}
    </Card>
  )
}

function MetricsSection({ metrics }: { metrics: NodeMetrics }) {
  const memPercent = metrics.memoryTotalMb > 0
    ? Math.round((metrics.memoryUsedMb / metrics.memoryTotalMb) * 100)
    : 0

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Metrics</h4>
      <div className="space-y-2 text-sm">
        {/* CPU */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>CPU</span>
            <span className="font-mono">{metrics.cpuPercent}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(metrics.cpuPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Memory */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>Memory</span>
            <span className="font-mono">
              {metrics.memoryUsedMb}MB / {metrics.memoryTotalMb}MB ({memPercent}%)
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(memPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Gauges */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="text-center">
            <div className="font-mono text-sm font-medium">{metrics.goroutines}</div>
            <div className="text-[10px] text-muted-foreground">Goroutines</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-sm font-medium">{metrics.openConnections}</div>
            <div className="text-[10px] text-muted-foreground">Connections</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-sm font-medium">{metrics.requestsPerSecond}</div>
            <div className="text-[10px] text-muted-foreground">RPS</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CertificatesSection({ certificates }: { certificates: NodeCertStatus[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Certificates</h4>
      <div className="space-y-1.5">
        {certificates.map((cert) => (
          <div key={cert.domain} className="flex items-center justify-between rounded border px-2 py-1.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono">{cert.domain}</span>
              <span className="text-muted-foreground">{cert.issuer}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{cert.daysUntilExpiry}d</span>
              <StatusBadge status={certStatusColor(cert.status)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SyncEventsSection({ events }: { events: SyncEvent[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent Sync</h4>
      <div className="space-y-1.5">
        {events.map((event, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 font-mono text-muted-foreground">
              {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <Badge variant="outline" className={syncTypeBadgeColor(event.type)}>
              {event.type.replace(/_/g, ' ')}
            </Badge>
            <Badge variant={event.status === 'success' ? 'default' : 'destructive'} className="text-[10px]">
              {event.status}
            </Badge>
            {event.detail && (
              <span className="truncate text-muted-foreground">{event.detail}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
