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
  PencilIcon,
  TrashIcon,
  ShieldIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { Role, Permission } from '@/lib/api'
import { useHasPermission } from '@/hooks/use-auth'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'

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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export const Route = createFileRoute('/settings/roles')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData({
        queryKey: ['roles'],
        queryFn: () => apiClient.get<Role[]>('/roles'),
      }),
      context.queryClient.ensureQueryData({
        queryKey: ['permissions'],
        queryFn: () => apiClient.get<Permission[]>('/permissions'),
      }),
    ]),
  component: RolesPage,
})

function RolesPage() {
  const canRead = useHasPermission('roles:read')
  const canManage = useHasPermission('roles:manage')
  const queryClient = useQueryClient()

  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiClient.get<Role[]>('/roles'),
  })

  const permissionsQuery = useQuery({
    queryKey: ['permissions'],
    queryFn: () => apiClient.get<Permission[]>('/permissions'),
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Role | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null)
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    scopes: [] as string[],
  })

  const createMutation = useMutation({
    mutationFn: () => apiClient.post('/roles', createForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success('Role created')
      setCreateOpen(false)
      setCreateForm({ name: '', description: '', scopes: [] })
    },
    onError: (err: { detail?: string }) =>
      toast.error(err.detail ?? 'Failed to create role'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/roles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success('Role deleted')
      setDeleteTarget(null)
    },
    onError: () => toast.error('Failed to delete role'),
  })

  if (!canRead) {
    return (
      <EmptyState
        icon={<ShieldIcon className="size-5" />}
        title="Access denied"
        description="You do not have permission to view roles."
      />
    )
  }

  const roles = rolesQuery.data ?? []
  const permissions = permissionsQuery.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles"
        description="Manage roles and permission scopes"
      />

      <DataTable
        title="Roles"
        columns={[
          {
            key: 'name',
            header: 'Name',
            sortable: true,
            render: (r) => (
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">{r.name as string}</span>
                {(r.is_builtin as boolean) && (
                  <Badge variant="secondary" className="text-xs">
                    built-in
                  </Badge>
                )}
              </div>
            ),
          },
          {
            key: 'description',
            header: 'Description',
            render: (r) => (
              <span className="text-sm text-muted-foreground">
                {r.description as string}
              </span>
            ),
          },
          {
            key: 'scopes',
            header: 'Scopes',
            render: (r) => (
              <span className="text-sm">
                {(r.scopes as string[]).length} scope
                {(r.scopes as string[]).length !== 1 ? 's' : ''}
              </span>
            ),
          },
          {
            key: '_actions',
            header: '',
            render: (r) => {
              const role = r as unknown as Role
              const isProtected = role.name === 'superadmin'
              if (!canManage || isProtected) return null
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" />}
                  >
                    <MoreHorizontalIcon className="size-4" />
                    <span className="sr-only">Actions</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditTarget(role)}>
                      <PencilIcon className="size-4" />
                      Edit scopes
                    </DropdownMenuItem>
                    {!role.is_builtin && (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleteTarget(role)}
                      >
                        <TrashIcon className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            },
          },
        ]}
        data={roles as unknown as Record<string, unknown>[]}
        pageSize={20}
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              Create role
            </Button>
          ) : undefined
        }
        emptyState={
          <EmptyState
            icon={<ShieldIcon className="size-5" />}
            title="No roles"
            description="No roles found."
          />
        }
      />

      {/* Create role dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
            <DialogDescription>
              Define a custom role with a specific set of permission scopes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="my-custom-role"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-desc">Description</Label>
              <Input
                id="role-desc"
                value={createForm.description}
                onChange={(e) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {permissions.map((p) => (
                  <Button
                    key={p.id}
                    variant={
                      createForm.scopes.includes(p.id) ? 'default' : 'outline'
                    }
                    size="xs"
                    onClick={() =>
                      setCreateForm((prev) => ({
                        ...prev,
                        scopes: prev.scopes.includes(p.id)
                          ? prev.scopes.filter((s) => s !== p.id)
                          : [...prev.scopes, p.id],
                      }))
                    }
                  >
                    {p.id}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                createMutation.isPending ||
                !createForm.name ||
                createForm.scopes.length === 0
              }
            >
              {createMutation.isPending ? 'Creating...' : 'Create role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit role sheet */}
      {editTarget && (
        <EditRoleSheet
          role={editTarget}
          permissions={permissions}
          open={editTarget !== null}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete role"
        description={`Delete "${deleteTarget?.name}"? Users with this role will lose associated permissions.`}
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

interface EditRoleSheetProps {
  role: Role
  permissions: Permission[]
  open: boolean
  onClose: () => void
}

function EditRoleSheet({
  role,
  permissions,
  open,
  onClose,
}: EditRoleSheetProps) {
  const queryClient = useQueryClient()
  const [scopes, setScopes] = useState<string[]>(role.scopes)

  const updateMutation = useMutation({
    mutationFn: () =>
      apiClient.patch(`/roles/${role.id}`, { scopes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success('Role updated')
      onClose()
    },
    onError: () => toast.error('Failed to update role'),
  })

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit role — {role.name}</SheetTitle>
          <SheetDescription>
            Toggle permission scopes for this role.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
          <div className="flex flex-wrap gap-1.5">
            {permissions.map((p) => (
              <Button
                key={p.id}
                variant={scopes.includes(p.id) ? 'default' : 'outline'}
                size="xs"
                onClick={() =>
                  setScopes((prev) =>
                    prev.includes(p.id)
                      ? prev.filter((s) => s !== p.id)
                      : [...prev, p.id],
                  )
                }
              >
                {p.id}
              </Button>
            ))}
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
