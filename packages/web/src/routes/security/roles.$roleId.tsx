import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeftIcon, TrashIcon } from 'lucide-react'
import { apiClient } from '@/lib/api'
import type { Role, UserInfo, ExpandedRole, PermissionRule } from '@/lib/api'
import { PermissionRuleEditor } from '@/components/rioku/permission-rule-editor'
import { RoleHierarchyTree } from '@/components/rioku/role-hierarchy-tree'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/security/roles/$roleId')({
  loader: async ({ context, params }) => {
    const [roles, users] = await Promise.all([
      context.queryClient.ensureQueryData({ queryKey: ['roles'], queryFn: () => apiClient.get<Role[]>('/auth/roles') }),
      context.queryClient.ensureQueryData({ queryKey: ['users'], queryFn: () => apiClient.get<UserInfo[]>('/auth/users') }),
    ])
    const role = roles.find((r) => r.id === params.roleId)
    if (!role) throw new Error('Role not found')
    const expandedRole: ExpandedRole = { ...role, parentRoleIds: [], childRoleIds: [], rules: [] }
    const expandedRoles: ExpandedRole[] = roles.map((r) => ({ ...r, parentRoleIds: [], childRoleIds: [], rules: [] }))
    const members = users.filter((u) => u.roles.includes(role.name))
    return { role: expandedRole, allRoles: expandedRoles, members }
  },
  component: RoleDetailPage,
})

export function RoleDetailPage() {
  const { t } = useTranslation('users')
  const { role, allRoles, members } = Route.useLoaderData()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('permissions')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [rules, setRules] = useState<PermissionRule[]>(role.rules ?? [])

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/auth/roles/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['roles'] }); toast.success('Role deleted'); navigate({ to: '/security/roles' }) },
    onError: () => toast.error('Failed to delete role'),
  })

  const isBuiltin = role.isBuiltin

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Link to="/security/roles" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> Back to roles
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{role.name}</h1>
          {isBuiltin && <Badge variant="secondary">Built-in</Badge>}
        </div>
        {role.description && <p className="text-sm text-muted-foreground">{role.description}</p>}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="hierarchy">Hierarchy</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>

        <TabsContent value="permissions">
          <Card>
            <CardHeader><CardTitle>Permission rules</CardTitle></CardHeader>
            <CardContent>
              <PermissionRuleEditor value={rules} onChange={setRules} readOnly={isBuiltin} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hierarchy">
          <Card>
            <CardHeader><CardTitle>Role hierarchy</CardTitle></CardHeader>
            <CardContent>
              <RoleHierarchyTree role={role} allRoles={allRoles} readOnly />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members">
          <Card>
            <CardHeader><CardTitle>Members ({members.length})</CardTitle></CardHeader>
            <CardContent>
              {members.length > 0 ? (
                <div className="space-y-2">
                  {members.map((u) => (
                    <div key={u.id} className="flex items-center gap-2">
                      <Link to="/security/users/$userId" params={{ userId: u.id }} className="text-sm text-primary hover:underline">{u.username}</Link>
                      <span className="text-xs text-muted-foreground">{u.email}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No users assigned to this role.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {!isBuiltin && (
        <Card className="border-destructive/50">
          <CardHeader><CardTitle className="text-destructive">Danger zone</CardTitle></CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <TrashIcon className="size-4" /> Delete role
            </Button>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete Role" description={`Delete role "${role.name}"? This cannot be undone.`} confirmLabel="Delete" variant="destructive" loading={deleteMutation.isPending} onConfirm={() => deleteMutation.mutate(role.id)} />
    </div>
  )
}
