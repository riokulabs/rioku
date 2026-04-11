import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeftIcon, TrashIcon, CopyIcon } from 'lucide-react'
import { apiClient } from '@/lib/api'
import type { UserInfo, Role } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { TimeAgo } from '@/components/rioku/time-ago'

export const Route = createFileRoute('/security/users/$userId')({
  loader: async ({ context, params }) => {
    const [users, roles] = await Promise.all([
      context.queryClient.ensureQueryData({
        queryKey: ['users'],
        queryFn: () => apiClient.get<UserInfo[]>('/auth/users'),
      }),
      context.queryClient.ensureQueryData({
        queryKey: ['roles'],
        queryFn: () => apiClient.get<Role[]>('/auth/roles'),
      }),
    ])
    const user = users.find((u) => u.id === params.userId)
    if (!user) throw new Error('User not found')
    return { user, allRoles: roles }
  },
  component: UserDetailPage,
})

export function UserDetailPage() {
  const { t } = useTranslation('users')
  const { user, allRoles } = Route.useLoaderData()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/auth/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(t('messages.userDeleted'))
      navigate({ to: '/security/users' })
    },
    onError: () => toast.error('Failed to delete user'),
  })

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div className="space-y-4">
        <Link
          to="/security/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {t('detail.backToList')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{user.username}</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Main column */}
        <div className="space-y-6">
          {/* Identity card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t('detail.identityCard')}</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setEditing(!editing)}>
                  {editing ? t('detail.cancelEdit') || 'Cancel' : 'Edit'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Display name</Label>
                  <Input value={user.displayName ?? ''} disabled={!editing} readOnly={!editing} />
                </div>
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input value={user.username} disabled readOnly />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={user.email ?? ''} disabled={!editing} readOnly={!editing} />
                </div>
                {/* NEEDS BACKEND fields — rendered disabled */}
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Title (coming soon)</Label>
                  <Input value="" disabled placeholder="Coming soon" />
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Department (coming soon)</Label>
                  <Input value="" disabled placeholder="Coming soon" />
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Phone (coming soon)</Label>
                  <Input value="" disabled placeholder="Coming soon" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Roles card */}
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.rolesCard')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {user.roles.map((role) => (
                  <Badge key={role} variant="outline">{role}</Badge>
                ))}
                {user.roles.length === 0 && (
                  <span className="text-sm text-muted-foreground">No roles assigned</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Security card */}
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.securityCard')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Password</span>
                    <Button variant="outline" size="sm" disabled>
                      {t('detail.changePassword')}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">MFA</span>
                    <Badge variant={user.totpEnabled ? 'default' : 'secondary'}>
                      {user.totpEnabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Status</span>
                    <Badge variant={user.status === 'active' ? 'default' : 'destructive'}>
                      {user.status}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-2">
                  <span className="text-sm font-medium">Active sessions</span>
                  <p className="text-sm text-muted-foreground">Session management coming soon.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Danger zone */}
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">{t('detail.dangerZone')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{t('detail.deleteConfirmation')}</p>
              <div className="flex items-center gap-2">
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={user.username}
                  className="max-w-xs"
                />
                <Button
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                  disabled={deleteConfirmText !== user.username}
                >
                  <TrashIcon className="size-4" />
                  {t('detail.deleteUser')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Metadata sidebar */}
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div>
                <span className="text-xs text-muted-foreground">Created</span>
                <div className="text-sm"><TimeAgo date={user.createdAt} /></div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Last login</span>
                <div className="text-sm">
                  {user.lastLogin ? <TimeAgo date={user.lastLogin} /> : '\u2014'}
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Account ID</span>
                <div className="flex items-center gap-1">
                  <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">{user.id}</code>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      navigator.clipboard.writeText(user.id)
                      toast.success('Copied')
                    }}
                  >
                    <CopyIcon className="size-3" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('detail.deleteUser')}
        description={`Delete user "${user.username}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(user.id)}
      />
    </div>
  )
}
