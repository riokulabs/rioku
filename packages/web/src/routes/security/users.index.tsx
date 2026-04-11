import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PlusIcon, ShieldIcon, MoreHorizontalIcon, TrashIcon, UserIcon } from 'lucide-react'
import { apiClient } from '@/lib/api'
import type { UserInfo, Role } from '@/lib/api'
import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { TimeAgo } from '@/components/rioku/time-ago'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useHasPermission } from '@/hooks/use-auth'

export const Route = createFileRoute('/security/users/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData({
        queryKey: ['users'],
        queryFn: () => apiClient.get<UserInfo[]>('/auth/users'),
      }),
      context.queryClient.ensureQueryData({
        queryKey: ['roles'],
        queryFn: () => apiClient.get<Role[]>('/auth/roles'),
      }),
    ]),
  component: UsersListPage,
})

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  suspended: 'secondary',
  locked: 'destructive',
}

export function UsersListPage() {
  const { t } = useTranslation('users')
  const navigate = useNavigate()
  const canManage = useHasPermission('users:manage')
  const [users, roles] = Route.useLoaderData()

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          canManage ? (
            <Button render={<Link to="/security/users" />}>
              <PlusIcon className="size-4" />
              {t('list.createUser')}
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={[
          {
            key: 'username',
            header: 'Username',
            sortable: true,
            render: (r) => (
              <Link
                to="/security/users/$userId"
                params={{ userId: r.id as string }}
                className="font-mono text-sm text-primary hover:underline"
              >
                {r.username as string}
              </Link>
            ),
          },
          {
            key: 'email',
            header: 'Email',
            render: (r) => (
              <span className="text-sm">{(r.email as string) ?? '\u2014'}</span>
            ),
          },
          {
            key: 'roles',
            header: 'Roles',
            render: (r) => {
              const userRoles = (r.roles as string[]) ?? []
              return (
                <div className="flex flex-wrap gap-1">
                  {userRoles.map((role) => (
                    <Badge key={role} variant="outline" className="text-xs">
                      {role}
                    </Badge>
                  ))}
                </div>
              )
            },
          },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <Badge variant={STATUS_VARIANT[(r.status as string)] ?? 'outline'}>
                {(r.status as string) ?? 'unknown'}
              </Badge>
            ),
          },
          {
            key: 'totpEnabled',
            header: 'MFA',
            render: (r) => (
              <span className="text-sm">
                {r.totpEnabled ? (
                  <Badge variant="default" className="text-xs">Enabled</Badge>
                ) : (
                  <span className="text-muted-foreground">Off</span>
                )}
              </span>
            ),
          },
          {
            key: 'lastLogin',
            header: 'Last login',
            sortable: true,
            render: (r) =>
              r.lastLogin ? <TimeAgo date={r.lastLogin as string} /> : '\u2014',
          },
        ]}
        data={users as unknown as Array<Record<string, unknown>>}
        searchable
        searchPlaceholder={t('list.searchPlaceholder')}
        pageSize={15}
        emptyState={
          <EmptyState
            icon={<UserIcon className="size-5" />}
            title="No users"
            description="No user accounts found."
          />
        }
      />
    </div>
  )
}
