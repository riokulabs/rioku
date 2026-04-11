import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PlusIcon, ShieldIcon } from 'lucide-react'
import { apiClient } from '@/lib/api'
import type { Role } from '@/lib/api'
import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useHasPermission } from '@/hooks/use-auth'

export const Route = createFileRoute('/security/roles/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['roles'],
      queryFn: () => apiClient.get<Role[]>('/auth/roles'),
    }),
  component: RolesListPage,
})

export function RolesListPage() {
  const { t } = useTranslation('users')
  const roles = Route.useLoaderData()
  const canManage = useHasPermission('roles:manage')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles"
        description="Manage role definitions and permissions"
        actions={canManage ? <Button render={<Link to="/security/roles" />}><PlusIcon className="size-4" /> Create role</Button> : undefined}
      />
      <DataTable
        columns={[
          { key: 'name', header: 'Name', sortable: true, render: (r) => (
            <div className="flex items-center gap-2">
              <Link to="/security/roles/$roleId" params={{ roleId: r.id as string }} className="font-mono text-sm text-primary hover:underline">{r.name as string}</Link>
              {Boolean(r.isBuiltin) && <Badge variant="secondary" className="text-xs">Built-in</Badge>}
            </div>
          )},
          { key: 'description', header: 'Description', render: (r) => <span className="text-sm text-muted-foreground">{(r.description as string) || '\u2014'}</span> },
          { key: 'permissions', header: 'Permissions', render: (r) => <span className="text-sm">{((r.permissions as string[]) ?? []).length} permissions</span> },
        ]}
        data={roles as unknown as Array<Record<string, unknown>>}
        searchable
        searchPlaceholder="Search roles..."
        pageSize={10}
        emptyState={<EmptyState icon={<ShieldIcon className="size-5" />} title="No roles" description="No roles configured." />}
      />
    </div>
  )
}
