import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PlusIcon, ShieldAlertIcon } from 'lucide-react'
import { apiClient } from '@/lib/api'
import type { AccessPolicy } from '@/lib/api'
import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/security/access-policies/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['access-policies'],
      queryFn: () => apiClient.get<AccessPolicy[]>('/auth/access-policies'),
    }),
  component: AccessPoliciesListPage,
})

export function AccessPoliciesListPage() {
  const { t } = useTranslation('access-policies')
  const policies = Route.useLoaderData()

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button render={<Link to="/security/access-policies/create" />}>
            <PlusIcon className="size-4" />
            {t('list.createPolicy')}
          </Button>
        }
      />

      <DataTable
        columns={[
          {
            key: 'name',
            header: 'Name',
            sortable: true,
            render: (r) => (
              <Link
                to="/security/access-policies/$policyId"
                params={{ policyId: r.id as string }}
                className="font-medium text-sm text-primary hover:underline"
              >
                {r.name as string}
              </Link>
            ),
          },
          {
            key: 'effect',
            header: 'Effect',
            render: (r) => (
              <Badge variant={(r.effect as string) === 'allow' ? 'default' : 'destructive'}>
                {r.effect as string}
              </Badge>
            ),
          },
          {
            key: 'targetType',
            header: 'Target Type',
            render: (r) => <span className="text-sm capitalize">{r.targetType as string}</span>,
          },
          {
            key: 'targetIds',
            header: 'Targets',
            render: (r) => (
              <div className="flex flex-wrap gap-1">
                {((r.targetIds as string[]) ?? []).map((id) => (
                  <Badge key={id} variant="outline" className="text-xs">{id}</Badge>
                ))}
              </div>
            ),
          },
          {
            key: 'conditions',
            header: 'Conditions',
            render: (r) => (
              <span className="text-sm">{((r.conditions as unknown[]) ?? []).length}</span>
            ),
          },
          {
            key: 'priority',
            header: 'Priority',
            sortable: true,
            render: (r) => <span className="text-sm">{r.priority as number}</span>,
          },
          {
            key: 'enabled',
            header: 'Status',
            render: (r) => (
              <Badge variant={(r.enabled as boolean) ? 'default' : 'secondary'}>
                {(r.enabled as boolean) ? 'Enabled' : 'Disabled'}
              </Badge>
            ),
          },
        ]}
        data={policies as unknown as Array<Record<string, unknown>>}
        searchable
        searchPlaceholder="Search policies..."
        pageSize={10}
        emptyState={
          <EmptyState
            icon={<ShieldAlertIcon className="size-5" />}
            title="No access policies"
            description="Create an access policy to define conditional access rules."
            action={
              <Button size="sm" render={<Link to="/security/access-policies/create" />}>
                <PlusIcon className="size-4" /> {t('list.createPolicy')}
              </Button>
            }
          />
        }
      />
    </div>
  )
}
