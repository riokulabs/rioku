import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeftIcon, TrashIcon, CopyIcon, MonitorIcon, XIcon } from 'lucide-react'
import { apiClient } from '@/lib/api'
import type { UserInfo, Role, ExpandedRole, AccessPolicy } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { TimeAgo } from '@/components/rioku/time-ago'
import { EffectivePermissionsPanel } from '@/components/rioku/effective-permissions'

interface UserSessionEntry {
  id: string
  device: string
  ip: string
  location: string
  lastActive: string
  current: boolean
}

export const Route = createFileRoute('/security/users/$userId')({
  loader: async ({ context, params }) => {
    const [users, roles, expandedRoles, accessPolicies] = await Promise.all([
      context.queryClient.ensureQueryData({
        queryKey: ['users'],
        queryFn: () => apiClient.get<UserInfo[]>('/auth/users'),
      }),
      context.queryClient.ensureQueryData({
        queryKey: ['roles'],
        queryFn: () => apiClient.get<Role[]>('/auth/roles'),
      }),
      context.queryClient.ensureQueryData({
        queryKey: ['expanded-roles'],
        queryFn: () => apiClient.get<ExpandedRole[]>('/auth/expanded-roles'),
      }),
      context.queryClient.ensureQueryData({
        queryKey: ['access-policies'],
        queryFn: () => apiClient.get<AccessPolicy[]>('/auth/access-policies'),
      }),
    ])
    const user = users.find((u) => u.id === params.userId)
    if (!user) throw new Error('User not found')
    return { user, allRoles: roles, expandedRoles, accessPolicies }
  },
  component: UserDetailPage,
})

export function UserDetailPage() {
  const { t } = useTranslation('users')
  const { user, allRoles, expandedRoles, accessPolicies } = Route.useLoaderData()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const assignedRoles = expandedRoles.filter((r) => user.roles.includes(r.name))

  const sessionsQuery = useQuery({
    queryKey: ['user-sessions', user.id],
    queryFn: () => apiClient.get<{ sessions: UserSessionEntry[] }>(`/auth/users/${user.id}/sessions`),
  })

  const terminateSessionMutation = useMutation({
    mutationFn: (sessionId: string) => apiClient.del(`/auth/users/${user.id}/sessions/${sessionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-sessions', user.id] })
      toast.success('Session terminated')
    },
    onError: () => toast.error('Failed to terminate session'),
  })

  const terminateAllMutation = useMutation({
    mutationFn: () => apiClient.del(`/auth/users/${user.id}/sessions`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-sessions', user.id] })
      toast.success('All other sessions terminated')
    },
    onError: () => toast.error('Failed to terminate sessions'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/auth/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(t('messages.userDeleted'))
      navigate({ to: '/security/users' })
    },
    onError: () => toast.error('Failed to delete user'),
  })

  const sessions = sessionsQuery.data?.sessions ?? []

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

          {/* Effective permissions panel */}
          <EffectivePermissionsPanel
            assignedRoles={assignedRoles}
            allRoles={expandedRoles}
            accessPolicies={accessPolicies}
          />

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
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Active sessions</span>
                    {sessions.filter((s) => !s.current).length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => terminateAllMutation.mutate()}
                        disabled={terminateAllMutation.isPending}
                      >
                        Terminate all others
                      </Button>
                    )}
                  </div>
                  {sessionsQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading sessions...</p>
                  ) : sessions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No active sessions</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Device</TableHead>
                          <TableHead>IP</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Last Active</TableHead>
                          <TableHead className="w-20" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sessions.map((session) => (
                          <TableRow key={session.id}>
                            <TableCell className="text-sm">
                              <div className="flex items-center gap-2">
                                <MonitorIcon className="size-4 text-muted-foreground" />
                                {session.device}
                                {session.current && <Badge variant="secondary" className="text-xs">Current</Badge>}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm font-mono">{session.ip}</TableCell>
                            <TableCell className="text-sm">{session.location}</TableCell>
                            <TableCell className="text-sm">
                              <TimeAgo date={session.lastActive} />
                            </TableCell>
                            <TableCell>
                              {!session.current && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => terminateSessionMutation.mutate(session.id)}
                                  disabled={terminateSessionMutation.isPending}
                                >
                                  <XIcon className="size-4" />
                                  <span className="sr-only">Terminate session</span>
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
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
