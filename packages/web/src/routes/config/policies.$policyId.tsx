import { useState } from 'react'
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeftIcon, PencilIcon, CodeIcon, TrashIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Policy, Route as RouteType } from '@/lib/api'
import { POLICY_TYPES, policyTypeColors } from './policies.index'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { TimeAgo } from '@/components/rioku/time-ago'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/config/policies/$policyId')({
  loader: async ({ context, params }) => {
    const config = await context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    })
    const policy = config.policies.find((p) => p.id === params.policyId)
    if (!policy) throw new Error('Policy not found')
    return { policy, routes: config.routes }
  },
  component: PolicyDetailPage,
})

function ConfigReadView({ config }: { config: Record<string, unknown> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {Object.entries(config).map(([key, value]) => (
        <div key={key} className="space-y-1">
          <dt className="text-xs font-medium text-muted-foreground">{key}</dt>
          <dd className="text-sm font-mono">
            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function PolicyDetailPage() {
  const { t } = useTranslation('policies')
  const { policy, routes } = Route.useLoaderData()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('config')

  const attachedRoutes = routes.filter((r: RouteType) =>
    (r.policyIds ?? []).includes(policy.id),
  )

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post('/config', { policy: { action: 'DELETE', id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success(t('messages.policyDeleted'))
      navigate({ to: '/config/policies' })
    },
    onError: () => toast.error('Failed to delete policy'),
  })

  const saveMutation = useMutation({
    mutationFn: (payload: { policy: { action: 'UPSERT'; policy: Partial<Policy> } }) =>
      apiClient.post('/config', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success(t('messages.policyUpdated'))
      setEditing(false)
    },
    onError: () => toast.error('Failed to update policy'),
  })

  return (
    <div className="space-y-6">
      {/* Back link + header */}
      <div className="space-y-4">
        <Link
          to="/config/policies"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {t('detail.backToList')}
        </Link>

        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{policy.name}</h1>
          <Badge variant={policyTypeColors[policy.type] ?? 'outline'}>
            {POLICY_TYPES[policy.type] ?? policy.type}
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="config">{t('detail.configuration')}</TabsTrigger>
          <TabsTrigger value="routes">{t('detail.attachedRoutes')}</TabsTrigger>
          <TabsTrigger value="activity">{t('detail.activity')}</TabsTrigger>
        </TabsList>

        {/* Configuration tab */}
        <TabsContent value="config">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t('detail.configuration')}</CardTitle>
                <div className="flex items-center gap-2">
                  {editing ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(false)}
                      >
                        {t('detail.cancelEdit')}
                      </Button>
                      <Button
                        size="sm"
                        disabled={saveMutation.isPending}
                        onClick={() => {
                          saveMutation.mutate({
                            policy: {
                              action: 'UPSERT',
                              policy: { id: policy.id, config: policy.config },
                            },
                          })
                        }}
                      >
                        {t('detail.saveConfig')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(true)}
                    >
                      <PencilIcon className="size-4" />
                      {t('detail.editConfig')}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ConfigReadView config={policy.config} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Attached Routes tab */}
        <TabsContent value="routes">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.attachedRoutes')}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={[
                  {
                    key: 'name',
                    header: 'Route',
                    sortable: true,
                    render: (r) => (
                      <Link
                        to="/config/routes"
                        className="text-primary hover:underline font-mono text-sm"
                      >
                        {r.name as string}
                      </Link>
                    ),
                  },
                  {
                    key: 'enabled',
                    header: 'Status',
                    render: (r) => (
                      <Badge variant={r.enabled ? 'default' : 'secondary'}>
                        {r.enabled ? 'Active' : 'Disabled'}
                      </Badge>
                    ),
                  },
                  {
                    key: 'updatedAt',
                    header: 'Updated',
                    sortable: true,
                    render: (r) =>
                      r.updatedAt ? <TimeAgo date={r.updatedAt as string} /> : '\u2014',
                  },
                ]}
                data={attachedRoutes as Array<Record<string, unknown>>}
                pageSize={10}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity tab */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.activity')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Activity tracking will be available in a future update.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Danger zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">{t('detail.dangerZone')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <TrashIcon className="size-4" />
            {t('detail.deletePolicy')}
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Policy"
        description={t('messages.confirmDelete')}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(policy.id)}
      />
    </div>
  )
}
