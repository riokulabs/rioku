import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeftIcon, TrashIcon } from 'lucide-react'
import { apiClient } from '@/lib/api'
import type { ApiKey } from '@/lib/api'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { TimeAgo } from '@/components/rioku/time-ago'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/security/api-keys/$keyId')({
  loader: async ({ context, params }) => {
    const keys = await context.queryClient.ensureQueryData({
      queryKey: ['api-keys'],
      queryFn: () => apiClient.get<ApiKey[]>('/auth/keys'),
    })
    const key = keys.find((k) => k.id === params.keyId)
    if (!key) throw new Error('API key not found')
    return { key }
  },
  component: ApiKeyDetailPage,
})

export function ApiKeyDetailPage() {
  const { t } = useTranslation('api-keys')
  const { key } = Route.useLoaderData()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('details')
  const [revokeOpen, setRevokeOpen] = useState(false)

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/auth/keys/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      toast.success(t('messages.keyRevoked'))
      navigate({ to: '/security/api-keys' })
    },
    onError: () => toast.error('Failed to revoke key'),
  })

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Link to="/security/api-keys" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> {t('detail.backToList')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{key.name}</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="details">{t('detail.details')}</TabsTrigger>
          <TabsTrigger value="usage">{t('detail.usage')}</TabsTrigger>
          <TabsTrigger value="activity">{t('detail.activity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card>
            <CardHeader><CardTitle>{t('detail.details')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Name</Label>
                  <Input value={key.name} readOnly />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Key prefix</Label>
                  <code className="block bg-muted px-2 py-1.5 rounded text-sm font-mono">{key.prefix}...</code>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Created</Label>
                  <div className="text-sm"><TimeAgo date={key.createdAt} /></div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Expires</Label>
                  <div className="text-sm">{key.expiresAt ? <TimeAgo date={key.expiresAt} /> : 'Never'}</div>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{t('detail.scopes')}</Label>
                <div className="flex flex-wrap gap-1">
                  {key.scopes.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage">
          <Card>
            <CardHeader><CardTitle>{t('detail.usage')}</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Usage statistics require backend support. Coming soon.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader><CardTitle>{t('detail.activity')}</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Activity tracking will be available in a future update.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="border-destructive/50">
        <CardHeader><CardTitle className="text-destructive">{t('detail.dangerZone')}</CardTitle></CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setRevokeOpen(true)}>
            <TrashIcon className="size-4" /> {t('detail.revokeKey')}
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog open={revokeOpen} onOpenChange={setRevokeOpen} title={t('detail.revokeKey')} description={`Revoke API key "${key.name}"? This cannot be undone.`} confirmLabel="Revoke" variant="destructive" loading={revokeMutation.isPending} onConfirm={() => revokeMutation.mutate(key.id)} />
    </div>
  )
}
