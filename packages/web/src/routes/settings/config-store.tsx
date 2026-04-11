import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  DownloadIcon,
  UploadIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigStoreSettingsResponse, MigrationInfo } from '@/lib/api'
import { SettingsField } from '@/components/rioku/settings-field'
import { StatusBadge } from '@/components/rioku/status-badge'
import { EmptyState } from '@/components/rioku/empty-state'
import { TimeAgo } from '@/components/rioku/time-ago'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const defaults: ConfigStoreSettingsResponse = {
  backendType: 'sqlite',
  connectionInfo: '/var/lib/rioku/store.db',
  configVersion: 42,
  storeHealth: 'healthy',
  migrations: [
    {
      version: 1,
      name: 'initial_schema',
      appliedAt: '2026-01-15T10:30:00Z',
      status: 'applied',
    },
    {
      version: 2,
      name: 'add_api_keys',
      appliedAt: '2026-02-01T14:00:00Z',
      status: 'applied',
    },
    {
      version: 3,
      name: 'add_audit_log',
      appliedAt: '2026-03-10T09:15:00Z',
      status: 'applied',
    },
  ],
}

export const Route = createFileRoute('/settings/config-store')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['settings', 'config-store'],
        queryFn: () =>
          apiClient.get<ConfigStoreSettingsResponse>('/settings/config-store'),
      })
      .catch(() => defaults),
  component: ConfigStoreSettingsPage,
})

const migrationStatusVariant: Record<
  MigrationInfo['status'],
  'default' | 'secondary' | 'destructive'
> = {
  applied: 'default',
  pending: 'secondary',
  failed: 'destructive',
}

function ConfigStoreSettingsPage() {
  const { t } = useTranslation('settings')
  const data = Route.useLoaderData() as ConfigStoreSettingsResponse

  const exportMutation = useMutation({
    mutationFn: () => apiClient.get<Blob>('/config/export'),
    onSuccess: () => toast.info('Config exported'),
    onError: () => toast.error('Export not yet available (needs backend)'),
  })

  const healthMap: Record<string, 'healthy' | 'degraded' | 'unhealthy' | 'unknown'> = {
    healthy: 'healthy',
    degraded: 'degraded',
    unhealthy: 'unhealthy',
    unknown: 'unknown',
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('configStore.title')}</CardTitle>
          <CardDescription>{t('configStore.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <SettingsField label={t('configStore.backendType')} readOnly>
              <Input value={data.backendType} readOnly className="font-mono" />
            </SettingsField>

            <SettingsField label={t('configStore.connectionInfo')} readOnly>
              <Input
                value={data.connectionInfo}
                readOnly
                className="font-mono"
                type="password"
              />
            </SettingsField>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <SettingsField label={t('configStore.configVersion')} readOnly>
              <Input
                value={`v${data.configVersion}`}
                readOnly
                className="font-mono"
              />
            </SettingsField>

            <SettingsField label={t('configStore.storeHealth')} readOnly>
              <div className="flex h-9 items-center">
                <StatusBadge
                  status={healthMap[data.storeHealth] ?? 'unknown'}
                />
              </div>
            </SettingsField>
          </div>
        </CardContent>
      </Card>

      {/* Migration history */}
      <Card>
        <CardHeader>
          <CardTitle>{t('configStore.migrations')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.migrations.length === 0 ? (
            <EmptyState title={t('configStore.noMigrations')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('configStore.migrationVersion')}</TableHead>
                    <TableHead>{t('configStore.migrationName')}</TableHead>
                    <TableHead>{t('configStore.migrationAppliedAt')}</TableHead>
                    <TableHead>{t('configStore.migrationStatus')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.migrations.map((m) => (
                    <TableRow key={m.version}>
                      <TableCell className="font-mono text-sm">
                        {m.version}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {m.name}
                      </TableCell>
                      <TableCell>
                        <TimeAgo date={m.appliedAt} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={migrationStatusVariant[m.status]}>
                          {m.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Export / Import */}
      <div className="flex items-center justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
        >
          <DownloadIcon className="size-3.5" data-icon="inline-start" />
          {t('configStore.exportConfig')}
        </Button>
        <Button variant="outline" disabled>
          <UploadIcon className="size-3.5" data-icon="inline-start" />
          {t('configStore.importConfig')}
        </Button>
      </div>
    </div>
  )
}
