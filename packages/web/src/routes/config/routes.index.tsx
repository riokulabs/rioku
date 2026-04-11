import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  PlusIcon,
  RouteIcon,
  PencilIcon,
  CopyIcon,
  TrashIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Route as RouteType } from '@/lib/api'
import { useRouteMutations } from '@/hooks/use-config-mutations'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { TimeAgo } from '@/components/rioku/time-ago'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'

import { useState, useMemo } from 'react'
import type { FilterColumn } from '@/components/rioku/faceted-filter'

function mockRps(name: string): number {
  let hash = 0
  for (const c of name) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0
  return Math.abs(hash % 900) + 100
}

function mockP95(name: string): number {
  let hash = 0
  for (const c of name) hash = ((hash << 5) - hash + c.charCodeAt(0) + 7) | 0
  return Math.abs(hash % 180) + 20
}

export const Route = createFileRoute('/config/routes/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    }),
  component: RouteListPage,
})

function RouteListPage() {
  const { t } = useTranslation('routes')
  const config = Route.useLoaderData()
  const routes = config.routes
  const services = config.services

  const { toggleMutation, deleteMutation, duplicateMutation } = useRouteMutations()
  const [deleteTarget, setDeleteTarget] = useState<RouteType | null>(null)

  function getServiceName(serviceId: string): string {
    return services.find((s) => s.id === serviceId)?.name ?? serviceId
  }

  const tableData = routes.map((r) => ({
    ...r,
    _matcherDisplay: r.matchers
      .flatMap((m) => [...(m.hosts ?? []), ...(m.paths ?? []).map((p) => p.value)])
      .join(', '),
    _serviceName: r.serviceId ? getServiceName(r.serviceId) : '\u2014',
    _policyCount: (r.policyIds ?? []).length,
    _rps: mockRps(r.name),
    _p95: mockP95(r.name),
    _enabled: r.enabled ? 'Enabled' : 'Disabled',
    _hasPolicy: (r.policyIds ?? []).length > 0 ? 'Yes' : 'No',
  }))

  const filterColumns: FilterColumn[] = useMemo(() => [
    {
      key: '_enabled',
      label: 'Status',
      options: [
        { label: 'Enabled', value: 'Enabled' },
        { label: 'Disabled', value: 'Disabled' },
      ],
    },
    {
      key: '_serviceName',
      label: 'Service',
      options: [...new Set(tableData.map((r) => r._serviceName))].filter((s) => s !== '\u2014').map((s) => ({
        label: s,
        value: s,
      })),
    },
    {
      key: '_hasPolicy',
      label: 'Has Policy',
      options: [
        { label: 'Yes', value: 'Yes' },
        { label: 'No', value: 'No' },
      ],
    },
  ], [tableData])

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button render={<Link to="/config/routes/create" />}>
            <PlusIcon className="size-4" />
            {t('form.createRoute')}
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
                to="/config/routes/$routeId"
                params={{ routeId: r.id as string }}
                className="font-mono text-sm text-primary hover:underline"
              >
                {r.name}
              </Link>
            ),
          },
          {
            key: '_matcherDisplay',
            header: t('table.matchers'),
            render: (r) => {
              const route = r as unknown as RouteType
              return (
                <div className="flex flex-wrap gap-1">
                  {route.matchers.flatMap((m, mi) => [
                    ...(m.hosts ?? []).map((h, hi) => (
                      <Badge key={`h-${mi}-${hi}`} variant="secondary">
                        {h}
                      </Badge>
                    )),
                    ...(m.paths ?? []).map((p, pi) => (
                      <Badge key={`p-${mi}-${pi}`} variant="outline">
                        {p.value}
                      </Badge>
                    )),
                  ])}
                </div>
              )
            },
          },
          {
            key: '_serviceName',
            header: t('table.targetService'),
            render: (r) => (
              <span className="font-mono text-sm text-muted-foreground">
                {r._serviceName}
              </span>
            ),
          },
          {
            key: '_policyCount',
            header: t('table.policies'),
            render: (r) => (
              <span className="text-sm text-muted-foreground">
                {r._policyCount === 0 ? '\u2014' : `${r._policyCount}`}
              </span>
            ),
          },
          {
            key: '_rps',
            header: 'RPS',
            sortable: true,
            render: (r) => (
              <span className="font-mono text-sm text-muted-foreground">
                {(r._rps as number).toLocaleString()}
              </span>
            ),
          },
          {
            key: '_p95',
            header: 'P95',
            sortable: true,
            render: (r) => (
              <span className="font-mono text-sm text-muted-foreground">
                {r._p95}ms
              </span>
            ),
          },
          {
            key: 'enabled',
            header: t('table.status'),
            render: (r) => (
              <Switch
                checked={r.enabled as boolean}
                onCheckedChange={() =>
                  toggleMutation.mutate({ id: r.id as string, enabled: r.enabled as boolean })
                }
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
        filterColumns={filterColumns}
        searchable
        searchPlaceholder="Search routes..."
        pageSize={10}
        rowActions={(row) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() =>
                toggleMutation.mutate({ id: row.id as string, enabled: row.enabled as boolean })
              }
            >
              <Switch checked={row.enabled as boolean} size="sm" />
              <span className="sr-only">
                {row.enabled ? t('common:actions.disable') : t('common:actions.enable')}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              render={<Link to="/config/routes/$routeId" params={{ routeId: row.id as string }} />}
            >
              <PencilIcon className="size-4" />
              <span className="sr-only">{t('form.editRoute')}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => duplicateMutation.mutate(row as unknown as Record<string, unknown>)}
            >
              <CopyIcon className="size-4" />
              <span className="sr-only">{t('form.duplicateRoute')}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setDeleteTarget(row as unknown as RouteType)}
            >
              <TrashIcon className="size-4 text-destructive" />
              <span className="sr-only">{t('common:actions.delete')}</span>
            </Button>
          </div>
        )}
        emptyState={
          <EmptyState
            icon={<RouteIcon className="size-5" />}
            title={t('empty.noRoutes')}
            description={t('empty.noRoutesDesc')}
            action={
              <Button size="sm" render={<Link to="/config/routes/create" />}>
                <PlusIcon className="size-4" />
                {t('form.createRoute')}
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
        confirmLabel={t('common:actions.delete')}
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
