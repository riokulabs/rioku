import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  PlusIcon,
  KeyIcon,
  CopyIcon,
  CheckIcon,
  AlertTriangleIcon,
  ShieldCheckIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ApiKey, HealthStatus, SessionInfo, MeResponse } from '@/lib/api'
import { useHasPermission } from '@/hooks/use-auth'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { StatusBadge } from '@/components/rioku/status-badge'
import type { Status } from '@/components/rioku/status-badge'
import { TimeAgo } from '@/components/rioku/time-ago'
import { Slot } from '@/components/plugin/slot'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const Route = createFileRoute('/security')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient
        .ensureQueryData({
          queryKey: ['keys'],
          queryFn: () => apiClient.get<ApiKey[]>('/keys'),
        })
        .catch(() => [] as ApiKey[]),
      context.queryClient
        .ensureQueryData({
          queryKey: ['health'],
          queryFn: () => apiClient.get<HealthStatus>('/health'),
        })
        .catch(() => null as HealthStatus | null),
      context.queryClient
        .ensureQueryData({
          queryKey: ['sessions'],
          queryFn: () => apiClient.get<SessionInfo[]>('/auth/sessions'),
        })
        .catch(() => [] as SessionInfo[]),
    ]),
  component: Security,
})

const SCOPES = [
  'admin',
  'config:read',
  'config:write',
  'traffic:read',
  'keys:manage',
] as const

const EXPIRY_OPTIONS = [
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
  { label: '1 year', value: '1y' },
  { label: 'Never', value: 'never' },
] as const

interface CreateKeyFormState {
  name: string
  scopes: string[]
  expiry: string
}

const emptyKeyForm: CreateKeyFormState = {
  name: '',
  scopes: [],
  expiry: '90d',
}

function Security() {
  const { t } = useTranslation('security')
  const queryClient = useQueryClient()

  const ctx = Route.useRouteContext() as { session: MeResponse }
  const rootSession = ctx.session
  const currentSessionId = rootSession.session.id
  const canReadSessions = useHasPermission('sessions:read')
  const canManageSessions = useHasPermission('sessions:manage')

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [keyForm, setKeyForm] = useState<CreateKeyFormState>(emptyKeyForm)
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [keyCopied, setKeyCopied] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null)

  const keysQuery = useQuery({
    queryKey: ['keys'],
    queryFn: () => apiClient.get<ApiKey[]>('/keys'),
  })

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.get<HealthStatus>('/health'),
  })

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => apiClient.get<SessionInfo[]>('/auth/sessions'),
  })
  const sessions = sessionsQuery.data ?? []
  const sessionsLoading = sessionsQuery.isLoading

  const revokeSessionMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/auth/sessions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      toast.success('Session revoked')
    },
    onError: () => toast.error('Failed to revoke session'),
  })

  const createKeyMutation = useMutation({
    mutationFn: (payload: {
      name: string
      scopes: string[]
      expiry: string
    }) => apiClient.post<{ key: string; api_key: ApiKey }>('/keys', payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      toast.success(t('messages.keyCreated'))
      setGeneratedKey(data.key)
    },
    onError: () => {
      toast.error('Failed to create API key')
    },
  })

  const revokeKeyMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/keys/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      toast.success(t('messages.keyRevoked'))
      setRevokeTarget(null)
    },
    onError: () => {
      toast.error('Failed to revoke API key')
    },
  })

  function openCreateDialog() {
    setKeyForm(emptyKeyForm)
    setGeneratedKey(null)
    setKeyCopied(false)
    setCreateDialogOpen(true)
  }

  function closeCreateDialog() {
    setCreateDialogOpen(false)
    setGeneratedKey(null)
    setKeyCopied(false)
    setKeyForm(emptyKeyForm)
  }

  function toggleScope(scope: string) {
    setKeyForm((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((s) => s !== scope)
        : [...prev.scopes, scope],
    }))
  }

  function handleCreateKey() {
    createKeyMutation.mutate({
      name: keyForm.name,
      scopes: keyForm.scopes,
      expiry: keyForm.expiry,
    })
  }

  function handleCopyKey() {
    if (!generatedKey) return
    navigator.clipboard.writeText(generatedKey).then(() => {
      setKeyCopied(true)
      setTimeout(() => setKeyCopied(false), 2000)
    })
  }

  const keys = (keysQuery.data ?? []).map((k) => ({ ...k }))

  // Derive certificate statuses from health data
  const health = healthQuery.data
  const certStatuses: Array<{
    label: string
    status: Status
    detail: string
  }> = health
    ? [
        {
          label: t('certs.caStatus'),
          status: (health.overall === 'healthy' ? 'healthy' : 'degraded') as Status,
          detail: health.overall === 'healthy' ? 'Root CA operational' : 'CA needs attention',
        },
        {
          label: t('certs.nodeCert'),
          status: (health.caddy?.status === 'healthy' ? 'healthy' : 'unknown') as Status,
          detail: health.caddy?.message ?? 'Checking...',
        },
        {
          label: t('certs.dbCert'),
          status: (health.store?.status === 'healthy' ? 'healthy' : 'unknown') as Status,
          detail: health.store?.message ?? 'Checking...',
        },
      ]
    : []

  const keysLoading = keysQuery.isLoading
  const healthLoading = healthQuery.isLoading

  return (
    <div className="space-y-8">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
      />

      {/* Session Management Section */}
      {canReadSessions && (
        <section className="space-y-4">
          {sessionsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-40" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              title="Active sessions"
              columns={[
                {
                  key: 'id',
                  header: 'Session',
                  render: (r) => (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">
                        {(r.id as string).slice(0, 8)}\u2026
                      </span>
                      {r.id === currentSessionId && (
                        <Badge variant="secondary">current</Badge>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'ip_address',
                  header: 'IP address',
                  render: (r) => (
                    <span className="font-mono text-sm">
                      {(r.ip_address as string) ?? '\u2014'}
                    </span>
                  ),
                },
                {
                  key: 'last_active',
                  header: 'Last active',
                  render: (r) => <TimeAgo date={r.last_active as string} />,
                },
                {
                  key: 'expires_at',
                  header: 'Expires',
                  render: (r) => <TimeAgo date={r.expires_at as string} />,
                },
                {
                  key: '_actions',
                  header: '',
                  render: (r) => {
                    const isCurrent = r.id === currentSessionId
                    if (!canManageSessions || isCurrent) return null
                    return (
                      <Button
                        variant="destructive"
                        size="xs"
                        onClick={() =>
                          revokeSessionMutation.mutate(r.id as string)
                        }
                        disabled={revokeSessionMutation.isPending}
                      >
                        Revoke
                      </Button>
                    )
                  },
                },
              ]}
              data={sessions as unknown as Record<string, unknown>[]}
              pageSize={10}
              emptyState={
                <EmptyState
                  icon={<ShieldCheckIcon className="size-5" />}
                  title="No active sessions"
                  description="No other sessions are currently active."
                />
              }
            />
          )}
        </section>
      )}

      {/* API Keys Section */}
      <section className="space-y-4">
        {keysLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-32" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <DataTable
            title={t('keys.apiKeys')}
            columns={[
              {
                key: 'name',
                header: 'Name',
                sortable: true,
                render: (r) => (
                  <span className="text-sm font-medium">{r.name as string}</span>
                ),
              },
              {
                key: 'prefix',
                header: t('keys.keyPrefix'),
                render: (r) => (
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.prefix as string}****
                  </span>
                ),
              },
              {
                key: 'scopes',
                header: t('keys.scopes'),
                render: (r) => (
                  <div className="flex flex-wrap gap-1">
                    {(r.scopes as string[]).map((scope) => (
                      <Badge key={scope} variant="secondary">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                ),
              },
              {
                key: 'expires_at',
                header: t('keys.expiresAt'),
                render: (r) =>
                  r.expires_at ? (
                    <TimeAgo date={r.expires_at as string} />
                  ) : (
                    <span className="text-sm text-muted-foreground">Never</span>
                  ),
              },
              {
                key: 'created_at',
                header: 'Created',
                sortable: true,
                render: (r) =>
                  r.created_at ? <TimeAgo date={r.created_at as string} /> : '\u2014',
              },
              {
                key: '_actions',
                header: '',
                render: (r) => (
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={() => setRevokeTarget(r as unknown as ApiKey)}
                  >
                    {t('keys.revokeKey')}
                  </Button>
                ),
              },
            ]}
            data={keys}
            searchable
            searchPlaceholder="Search keys..."
            pageSize={10}
            actions={
              <Button onClick={openCreateDialog}>
                <PlusIcon className="size-4" />
                {t('keys.createKey')}
              </Button>
            }
            emptyState={
              <EmptyState
                icon={<KeyIcon className="size-5" />}
                title="No API keys"
                description="Create an API key to authenticate requests to the Rioku API."
                action={
                  <Button onClick={openCreateDialog} size="sm">
                    <PlusIcon className="size-4" />
                    {t('keys.createKey')}
                  </Button>
                }
              />
            }
          />
        )}
      </section>

      {/* Certificate Status Section */}
      <section className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('certs.certificateStatus')}</CardTitle>
            <CardDescription>
              PKI health and certificate expiry status
            </CardDescription>
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : certStatuses.length > 0 ? (
              <div className="divide-y">
                {certStatuses.map((cert) => (
                  <div
                    key={cert.label}
                    className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                  >
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{cert.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {cert.detail}
                      </p>
                    </div>
                    <StatusBadge status={cert.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Unable to retrieve certificate status.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <Slot zone="security.sections" />

      {/* Create Key Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          {generatedKey ? (
            <>
              <DialogHeader>
                <DialogTitle>API Key Created</DialogTitle>
                <DialogDescription>
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <AlertTriangleIcon className="size-4 shrink-0" />
                    {t('keys.showOnce')}
                  </span>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
                  <code className="flex-1 break-all text-xs font-mono">
                    {generatedKey}
                  </code>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={handleCopyKey}
                  >
                    {keyCopied ? (
                      <CheckIcon className="size-4" />
                    ) : (
                      <CopyIcon className="size-4" />
                    )}
                    <span className="sr-only">Copy</span>
                  </Button>
                </div>
              </div>

              <DialogFooter>
                <Button onClick={closeCreateDialog}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t('keys.createKey')}</DialogTitle>
                <DialogDescription>
                  Generate a new API key for programmatic access.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Key Name */}
                <div className="space-y-2">
                  <Label htmlFor="key-name">{t('keys.keyName')}</Label>
                  <Input
                    id="key-name"
                    value={keyForm.name}
                    onChange={(e) =>
                      setKeyForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="CI Pipeline"
                  />
                </div>

                {/* Scopes */}
                <div className="space-y-2">
                  <Label>{t('keys.scopes')}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {SCOPES.map((scope) => (
                      <Button
                        key={scope}
                        variant={
                          keyForm.scopes.includes(scope)
                            ? 'default'
                            : 'outline'
                        }
                        size="xs"
                        onClick={() => toggleScope(scope)}
                      >
                        {scope}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Expiry */}
                <div className="space-y-2">
                  <Label>Expiry</Label>
                  <Select
                    value={keyForm.expiry}
                    onValueChange={(val) =>
                      setKeyForm((prev) => ({ ...prev, expiry: val ?? '90d' }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeCreateDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateKey}
                  disabled={
                    createKeyMutation.isPending ||
                    !keyForm.name ||
                    keyForm.scopes.length === 0
                  }
                >
                  <ShieldCheckIcon className="size-4" />
                  {createKeyMutation.isPending ? 'Creating...' : 'Create Key'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke Key Confirmation */}
      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
        title={t('keys.revokeKey')}
        description={t('messages.confirmRevoke')}
        confirmLabel="Revoke"
        variant="destructive"
        loading={revokeKeyMutation.isPending}
        onConfirm={() => {
          if (revokeTarget) revokeKeyMutation.mutate(revokeTarget.id)
        }}
      />
    </div>
  )
}
