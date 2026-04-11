import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  PlusIcon,
  ServerIcon,
  PencilIcon,
  TrashIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Service } from '@/lib/api'
import { LB_POLICY_LABELS } from '@/lib/schemas/service'
import { useServiceMutations } from '@/hooks/use-config-mutations'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { StatusBadge } from '@/components/rioku/status-badge'
import { TimeAgo } from '@/components/rioku/time-ago'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/config/services/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    }),
  component: ServiceListPage,
})

function ServiceListPage() {
  const { t } = useTranslation('services')
  const config = Route.useLoaderData()
  const services = config.services

  const { deleteMutation } = useServiceMutations()
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null)

  const tableData = services.map((svc) => ({
    ...svc,
    _upstreamCount: svc.upstreams.length,
    _upstreamPreview: svc.upstreams[0]?.address ?? '\u2014',
    _healthCheckEnabled: svc.healthCheck?.enabled ?? false,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button render={<Link to="/config/services/create" />}>
            <PlusIcon className="size-4" />
            {t('form.createService')}
          </Button>
        }
      />

      <DataTable
        columns={[
          {
            key: 'name',
            header: t('table.name'),
            sortable: true,
            render: (r) => (
              <Link
                to="/config/services/$serviceId"
                params={{ serviceId: r.id as string }}
                className="font-mono text-sm text-primary hover:underline"
              >
                {r.name}
              </Link>
            ),
          },
          {
            key: '_upstreamCount',
            header: t('table.upstreams'),
            render: (r) => (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{r._upstreamCount}</Badge>
                <span className="truncate text-xs text-muted-foreground font-mono">
                  {r._upstreamPreview}
                </span>
              </div>
            ),
          },
          {
            key: 'lbPolicy',
            header: t('table.lbPolicy'),
            render: (r) => (
              <Badge variant="outline">
                {LB_POLICY_LABELS[r.lbPolicy as string] ?? r.lbPolicy}
              </Badge>
            ),
          },
          {
            key: '_health',
            header: t('table.health'),
            render: (r) => (
              <StatusBadge
                status={r._healthCheckEnabled ? 'healthy' : 'unknown'}
                label={r._healthCheckEnabled ? 'Monitored' : 'Unmonitored'}
              />
            ),
          },
          {
            key: 'updatedAt',
            header: t('table.updated'),
            sortable: true,
            render: (r) =>
              r.updatedAt ? <TimeAgo date={r.updatedAt as string} /> : '\u2014',
          },
        ]}
        data={tableData}
        searchable
        searchPlaceholder="Search services..."
        pageSize={10}
        rowActions={(row) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              render={<Link to="/config/services/$serviceId" params={{ serviceId: row.id as string }} />}
            >
              <PencilIcon className="size-4" />
              <span className="sr-only">{t('form.editService')}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setDeleteTarget(row as unknown as Service)}
            >
              <TrashIcon className="size-4 text-destructive" />
              <span className="sr-only">Delete</span>
            </Button>
          </div>
        )}
        emptyState={
          <EmptyState
            icon={<ServerIcon className="size-5" />}
            title={t('empty.noServices')}
            description={t('empty.noServicesDesc')}
            action={
              <Button size="sm" render={<Link to="/config/services/create" />}>
                <PlusIcon className="size-4" />
                {t('form.createService')}
              </Button>
            }
          />
        }
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('messages.confirmDeleteTitle')}
        description={t('messages.confirmDelete')}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
