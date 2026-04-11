import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PlusIcon, KeyIcon, CopyIcon } from 'lucide-react'
import { apiClient } from '@/lib/api'
import type { ApiKey } from '@/lib/api'
import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { TimeAgo } from '@/components/rioku/time-ago'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'

export const Route = createFileRoute('/security/api-keys/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['api-keys'],
      queryFn: () => apiClient.get<ApiKey[]>('/auth/keys'),
    }),
  component: ApiKeysListPage,
})

export function ApiKeysListPage() {
  const { t } = useTranslation('api-keys')
  const queryClient = useQueryClient()
  const keys = Route.useLoaderData()

  const [createOpen, setCreateOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; scopes: string[] }) =>
      apiClient.post<{ key: string }>('/auth/keys', payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      setCreatedKey((data as { key: string }).key)
      toast.success(t('messages.keyCreated'))
    },
    onError: () => toast.error('Failed to create key'),
  })

  function handleCreate() {
    if (!newKeyName.trim()) return
    createMutation.mutate({ name: newKeyName.trim(), scopes: ['*'] })
  }

  function closeDialog() {
    setCreateOpen(false)
    setNewKeyName('')
    setCreatedKey(null)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            {t('list.createKey')}
          </Button>
        }
      />

      <DataTable
        columns={[
          { key: 'name', header: 'Name', sortable: true, render: (r) => (
            <Link to="/security/api-keys/$keyId" params={{ keyId: r.id as string }} className="font-mono text-sm text-primary hover:underline">{r.name as string}</Link>
          )},
          { key: 'prefix', header: 'Prefix', render: (r) => <code className="text-xs bg-muted px-1 py-0.5 rounded">{r.prefix as string}...</code> },
          { key: 'scopes', header: 'Scopes', render: (r) => (
            <div className="flex flex-wrap gap-1">{((r.scopes as string[]) ?? []).map((s) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}</div>
          )},
          { key: 'expiresAt', header: 'Expires', sortable: true, render: (r) => r.expiresAt ? <TimeAgo date={r.expiresAt as string} /> : 'Never' },
          { key: 'createdAt', header: 'Created', sortable: true, render: (r) => <TimeAgo date={r.createdAt as string} /> },
        ]}
        data={keys as unknown as Array<Record<string, unknown>>}
        searchable
        searchPlaceholder={t('list.searchPlaceholder')}
        pageSize={10}
        emptyState={<EmptyState icon={<KeyIcon className="size-5" />} title="No API keys" description="Create an API key for programmatic access." action={<Button size="sm" onClick={() => setCreateOpen(true)}><PlusIcon className="size-4" /> {t('list.createKey')}</Button>} />}
      />

      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('list.createKey')}</DialogTitle>
            <DialogDescription>Create a new API key for programmatic access.</DialogDescription>
          </DialogHeader>
          {createdKey ? (
            <div className="space-y-3">
              <p className="text-sm text-amber-500 font-medium">{t('messages.showOnce')}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted p-2 rounded text-xs font-mono break-all">{createdKey}</code>
                <Button variant="outline" size="icon-sm" onClick={() => { navigator.clipboard.writeText(createdKey); toast.success('Copied') }}>
                  <CopyIcon className="size-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="key-name">{t('detail.details')}</Label>
                <Input id="key-name" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="my-ci-key" />
              </div>
            </div>
          )}
          <DialogFooter>
            {createdKey ? (
              <Button onClick={closeDialog}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeDialog}>Cancel</Button>
                <Button onClick={handleCreate} disabled={!newKeyName.trim() || createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
