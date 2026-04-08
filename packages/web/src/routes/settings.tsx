import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Save } from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { StatusBadge } from '@/components/rioku/status-badge'
import { Slot } from '@/components/plugin/slot'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { apiClient } from '@/lib/api'

interface SettingsData {
  daemon_address: string
  data_directory: string
  store_driver: string
  store_connection: string
  pki_algorithm: string
  pki_rotation_threshold: string
  pki_cert_status: string
  ai_trace_store: string
  ai_retention_period: string
  log_level: string
}

export const Route = createFileRoute('/settings')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['settings'],
      queryFn: () => apiClient.get<SettingsData>('/settings'),
    }),
  component: Settings,
})

function Settings() {
  const { t } = useTranslation('settings')

  const data = Route.useLoaderData()
  const isLoading = false

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      ) : (
        <>
          {/* General */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.general')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('labels.daemonAddress')}</Label>
                  <Input
                    value={data?.daemon_address ?? '0.0.0.0:7778'}
                    readOnly
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('labels.dataDirectory')}</Label>
                  <Input
                    value={data?.data_directory ?? '/var/lib/rioku'}
                    readOnly
                    className="font-mono"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Store */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.store')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('labels.driver')}</Label>
                  <Input
                    value={data?.store_driver ?? 'sqlite'}
                    readOnly
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('labels.connectionString')}</Label>
                  <Input
                    value={
                      data?.store_connection ?? '/var/lib/rioku/store.db'
                    }
                    readOnly
                    className="font-mono"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* PKI */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.pki')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label>{t('labels.caAlgorithm')}</Label>
                  <Select
                    defaultValue={data?.pki_algorithm ?? 'ecdsa-p256'}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ecdsa-p256">ECDSA P-256</SelectItem>
                      <SelectItem value="ecdsa-p384">ECDSA P-384</SelectItem>
                      <SelectItem value="ed25519">Ed25519</SelectItem>
                      <SelectItem value="rsa-4096">RSA 4096</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('labels.rotationThreshold')}</Label>
                  <Input
                    value={data?.pki_rotation_threshold ?? '30 days'}
                    readOnly
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('labels.certStatus')}</Label>
                  <div className="flex h-8 items-center">
                    <StatusBadge
                      status={
                        (data?.pki_cert_status as 'healthy' | 'degraded' | 'unhealthy') ??
                        'healthy'
                      }
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.ai')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('labels.traceStore')}</Label>
                  <Select
                    defaultValue={data?.ai_trace_store ?? 'sqlite'}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sqlite">SQLite</SelectItem>
                      <SelectItem value="postgres">PostgreSQL</SelectItem>
                      <SelectItem value="none">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('labels.retentionPeriod')}</Label>
                  <Input
                    value={data?.ai_retention_period ?? '90 days'}
                    readOnly
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Logging */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.logging')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-w-xs space-y-2">
                <Label>{t('labels.logLevel')}</Label>
                <Select defaultValue={data?.log_level ?? 'info'}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="debug">debug</SelectItem>
                    <SelectItem value="info">info</SelectItem>
                    <SelectItem value="warn">warn</SelectItem>
                    <SelectItem value="error">error</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Plugin injection zone */}
          <Slot zone="settings.sections" />

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <Button variant="outline">
              <RotateCcw className="size-3.5" data-icon="inline-start" />
              {t('actions.reset')}
            </Button>
            <Button>
              <Save className="size-3.5" data-icon="inline-start" />
              {t('actions.saveChanges')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
