import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  PlusIcon,
  MoreHorizontalIcon,
  ShieldOffIcon,
  ShieldCheckIcon,
  UnlockIcon,
  KeyRoundIcon,
  PencilIcon,
  UsersIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { UserInfo, Role } from '@/lib/api'
import { useHasPermission } from '@/hooks/use-auth'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { TimeAgo } from '@/components/rioku/time-ago'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export const Route = createFileRoute('/settings/users')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['users'],
      queryFn: () => apiClient.get<UserInfo[]>('/users'),
    }),
  component: UsersPage,
})

// Status badge colours match the UserInfo.status values
const STATUS_VARIANT: Record<
  UserInfo['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  active: 'default',
  suspended: 'destructive',
  locked: 'outline',
}

function UsersPage() {
  const canRead = useHasPermission('users:read')
  const canCreate = useHasPermission('users:create')
  const canManage = useHasPermission('users:manage')
  const queryClient = useQueryClient()

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.get<UserInfo[]>('/users'),
  })

  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiClient.get<Role[]>('/roles'),
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<UserInfo | null>(null)
  const [suspendTarget, setSuspendTarget] = useState<UserInfo | null>(null)

  // Create user form state
  const [createForm, setCreateForm] = useState({
    username: '',
    displayName: '',
    email: '',
    password: '',
  })

  const createMutation = useMutation({
    mutationFn: (payload: typeof createForm) =>
      apiClient.post('/users', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User created')
      setCreateOpen(false)
      setCreateForm({ username: '', displayName: '', email: '', password: '' })
    },
    onError: (err: { detail?: string }) =>
      toast.error(err.detail ?? 'Failed to create user'),
  })

  const suspendMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/users/${id}/suspend`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User suspended')
      setSuspendTarget(null)
    },
    onError: () => toast.error('Failed to suspend user'),
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/users/${id}/activate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User activated')
    },
    onError: () => toast.error('Failed to activate user'),
  })

  const unlockMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/users/${id}/unlock`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('Account unlocked')
    },
    onError: () => toast.error('Failed to unlock account'),
  })

  const resetPasswordMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/users/${id}/reset-password`),
    onSuccess: () => toast.success('Password reset — user will be prompted on next login'),
    onError: () => toast.error('Failed to reset password'),
  })

  if (!canRead) {
    return (
      <EmptyState
        icon={<UsersIcon className="size-5" />}
        title="Access denied"
        description="You do not have permission to view users."
      />
    )
  }

  const users = usersQuery.data ?? []
  const roles = rolesQuery.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Manage user accounts and role assignments"
      />

      <DataTable
        title="User accounts"
        columns={[
          {
            key: 'username',
            header: 'Username',
            sortable: true,
            render: (r) => (
              <span className="font-mono text-sm">{r.username as string}</span>
            ),
          },
          {
            key: 'displayName',
            header: 'Name',
            render: (r) => (
              <span className="text-sm">
                {(r.displayName as string) ?? '\u2014'}
              </span>
            ),
          },
          {
            key: 'roles',
            header: 'Roles',
            render: (r) => (
              <div className="flex flex-wrap gap-1">
                {(r.roles as string[]).map((role) => (
                  <Badge key={role} variant="secondary">
                    {role}
                  </Badge>
                ))}
              </div>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <Badge variant={STATUS_VARIANT[r.status as UserInfo['status']]}>
                {r.status as string}
              </Badge>
            ),
          },
          {
            key: 'lastLogin',
            header: 'Last login',
            render: (r) =>
              r.lastLogin ? (
                <TimeAgo date={r.lastLogin as string} />
              ) : (
                <span className="text-sm text-muted-foreground">Never</span>
              ),
          },
          {
            key: '_actions',
            header: '',
            render: (r) => {
              const user = r as unknown as UserInfo
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" />}
                  >
                    <MoreHorizontalIcon className="size-4" />
                    <span className="sr-only">Actions</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canManage && (
                      <DropdownMenuItem
                        onClick={() => setEditTarget(user)}
                      >
                        <PencilIcon className="size-4" />
                        Edit
                      </DropdownMenuItem>
                    )}
                    {canManage && (
                      <DropdownMenuItem
                        onClick={() => resetPasswordMutation.mutate(user.id)}
                      >
                        <KeyRoundIcon className="size-4" />
                        Reset password
                      </DropdownMenuItem>
                    )}
                    {canManage && user.status === 'locked' && (
                      <DropdownMenuItem
                        onClick={() => unlockMutation.mutate(user.id)}
                      >
                        <UnlockIcon className="size-4" />
                        Unlock account
                      </DropdownMenuItem>
                    )}
                    {canManage && user.status === 'active' && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setSuspendTarget(user)}
                        >
                          <ShieldOffIcon className="size-4" />
                          Suspend
                        </DropdownMenuItem>
                      </>
                    )}
                    {canManage && user.status === 'suspended' && (
                      <DropdownMenuItem
                        onClick={() => activateMutation.mutate(user.id)}
                      >
                        <ShieldCheckIcon className="size-4" />
                        Activate
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            },
          },
        ]}
        data={users as unknown as Record<string, unknown>[]}
        searchable
        searchPlaceholder="Search users..."
        pageSize={20}
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              Create user
            </Button>
          ) : undefined
        }
        emptyState={
          <EmptyState
            icon={<UsersIcon className="size-5" />}
            title="No users"
            description="No user accounts found."
          />
        }
      />

      {/* Create user dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              Add a new user account. The user will be prompted to change their
              password on first login.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-username">Username</Label>
              <Input
                id="new-username"
                value={createForm.username}
                onChange={(e) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    username: e.target.value,
                  }))
                }
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-display-name">Display name</Label>
              <Input
                id="new-display-name"
                value={createForm.displayName}
                onChange={(e) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    displayName: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                value={createForm.email}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, email: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Initial password</Label>
              <Input
                id="new-password"
                type="password"
                value={createForm.password}
                onChange={(e) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(createForm)}
              disabled={
                createMutation.isPending ||
                !createForm.username ||
                !createForm.password
              }
            >
              {createMutation.isPending ? 'Creating...' : 'Create user'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit user sheet */}
      <EditUserSheet
        user={editTarget}
        roles={roles}
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
      />

      {/* Suspend confirmation */}
      <ConfirmDialog
        open={suspendTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSuspendTarget(null)
        }}
        title="Suspend user"
        description={`Suspend ${suspendTarget?.username}? All active sessions will be revoked immediately.`}
        confirmLabel="Suspend"
        variant="destructive"
        loading={suspendMutation.isPending}
        onConfirm={() => {
          if (suspendTarget) suspendMutation.mutate(suspendTarget.id)
        }}
      />
    </div>
  )
}

interface EditUserSheetProps {
  user: UserInfo | null
  roles: Role[]
  open: boolean
  onClose: () => void
}

function EditUserSheet({ user, roles, open, onClose }: EditUserSheetProps) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')

  const updateMutation = useMutation({
    mutationFn: () =>
      apiClient.patch(`/users/${user!.id}`, {
        displayName,
        email,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User updated')
      onClose()
    },
    onError: () => toast.error('Failed to update user'),
  })

  const assignRoleMutation = useMutation({
    mutationFn: (roleId: string) =>
      apiClient.post(`/users/${user!.id}/roles`, { roleId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: () => toast.error('Failed to assign role'),
  })

  const removeRoleMutation = useMutation({
    mutationFn: (roleId: string) =>
      apiClient.del(`/users/${user!.id}/roles/${roleId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: () => toast.error('Failed to remove role'),
  })

  if (!user) return null

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit user — {user.username}</SheetTitle>
          <SheetDescription>
            Update profile details and role assignments.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
          <div className="space-y-2">
            <Label htmlFor="edit-display-name">Display name</Label>
            <Input
              id="edit-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Roles</Label>
            <div className="flex flex-wrap gap-1.5">
              {roles.map((role) => {
                const assigned = user.roles.includes(role.name)
                return (
                  <Button
                    key={role.id}
                    variant={assigned ? 'default' : 'outline'}
                    size="xs"
                    onClick={() =>
                      assigned
                        ? removeRoleMutation.mutate(role.id)
                        : assignRoleMutation.mutate(role.id)
                    }
                  >
                    {role.name}
                  </Button>
                )
              })}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
