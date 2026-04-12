import { useState, useMemo } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ShieldIcon,
  MoreHorizontalIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Policy, Route as RouteType } from '@/lib/api'
import { POLICY_TYPE_LABELS } from '@/lib/schemas/policy-schemas'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { TimeAgo } from '@/components/rioku/time-ago'

import type { FilterColumn } from '@/components/rioku/faceted-filter'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export const Route = createFileRoute('/config/policies/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    }),
  component: PolicyListPage,
})

export const POLICY_TYPES = POLICY_TYPE_LABELS

export const policyTypeColors: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  POLICY_TYPE_RATE_LIMIT: 'default',
  POLICY_TYPE_AUTH_API_KEY: 'default',
  POLICY_TYPE_AUTHENTICATION: 'secondary',
  POLICY_TYPE_CORS: 'outline',
  POLICY_TYPE_CIRCUIT_BREAKER: 'destructive',
  POLICY_TYPE_RETRY: 'secondary',
  POLICY_TYPE_CACHE: 'outline',
  POLICY_TYPE_TRANSFORM: 'default',
}

export function PolicyListPage() {
  const { t } = useTranslation('policies')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [deleteTarget, setDeleteTarget] = useState<Policy | null>(null)

  const config = Route.useLoaderData()
  const policies = config.policies
  const routes = config.routes

  function countAttachedRoutes(policyId: string): number {
    return routes.filter((r: RouteType) => (r.policyIds ?? []).includes(policyId)).length
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post('/config', {
        policy: { action: 'DELETE', id },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success(t('messages.policyDeleted'))
      setDeleteTarget(null)
    },
    onError: () => {
      toast.error('Failed to delete policy')
    },
  })

  const tableData = policies.map((p) => ({
    ...p,
    _attachedCount: countAttachedRoutes(p.id),
  }))

  const filterColumns: FilterColumn[] = useMemo(() => [
    {
      key: 'type',
      label: 'Type',
      options: Object.entries(POLICY_TYPES).map(([value, label]) => ({
        label,
        value,
      })),
    },
  ], [])

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button render={<Link to="/config/policies/create" />}>
            <PlusIcon className="size-4" />
            {t('form.createPolicy')}
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
                to="/config/policies/$policyId"
                params={{ policyId: r.id as string }}
                className="font-mono text-sm text-primary hover:underline"
              >
                {r.name as string}
              </Link>
            ),
          },
          {
            key: 'type',
            header: t('table.type'),
            render: (r) => (
              <Badge variant={policyTypeColors[r.type as string] ?? 'outline'}>
                {POLICY_TYPES[r.type as string] ?? r.type}
              </Badge>
            ),
          },
          {
            key: '_attachedCount',
            header: t('table.attachedTo'),
            render: (r) => {
              const count = r._attachedCount as number
              return (
                <span className="text-sm text-muted-foreground">
                  {count === 0
                    ? t('list.noRoutes')
                    : count === 1
                      ? t('list.routeCount', { count })
                      : t('list.routeCount_plural', { count })}
                </span>
              )
            },
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
        searchPlaceholder="Search policies..."
        pageSize={10}
        rowActions={(r) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <MoreHorizontalIcon className="size-4" />
              <span className="sr-only">{t('table.actions')}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  navigate({
                    to: '/config/policies/$policyId',
                    params: { policyId: r.id as string },
                  })
                }
              >
                <PencilIcon className="size-4" />
                {t('form.editPolicy')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteTarget(r as unknown as Policy)}
              >
                <TrashIcon className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        emptyState={
          <EmptyState
            icon={<ShieldIcon className="size-5" />}
            title={t('empty.noPolicies')}
            description={t('empty.noPoliciesDesc')}
            action={
              <Button
                size="sm"
                render={<Link to="/config/policies/create" />}
              >
                <PlusIcon className="size-4" />
                {t('form.createPolicy')}
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
        title="Delete Policy"
        description={
          deleteTarget && countAttachedRoutes(deleteTarget.id) > 0
            ? `This policy is attached to ${countAttachedRoutes(deleteTarget.id)} route(s). Deleting it will remove it from those routes. ${t('messages.confirmDelete')}`
            : t('messages.confirmDelete')
        }
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
        }}
      />
    </div>
  )
}
