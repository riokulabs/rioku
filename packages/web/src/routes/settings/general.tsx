import { createFileRoute } from '@tanstack/react-router'
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> feat/admin-panel-phase5
import { useTranslation } from 'react-i18next'
import { RotateCcw, Save } from 'lucide-react'

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
<<<<<<< HEAD
=======
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SaveIcon, RotateCcwIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { GeneralSettingsResponse } from '@/lib/api'
import {
  generalSettingsSchema,
  type GeneralSettings,
} from '@/lib/schemas/settings'
import { SettingsField } from '@/components/rioku/settings-field'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
>>>>>>> feat/admin-panel-phase4
=======
>>>>>>> feat/admin-panel-phase5
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> feat/admin-panel-phase5
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
<<<<<<< HEAD
=======

// Realistic defaults for when backend API is not wired
const defaults: GeneralSettings = {
  instanceName: 'rioku-gateway',
  dataDirectory: '/var/lib/rioku',
  logLevel: 'info',
  daemonVersion: '0.3.0',
  caddyVersion: '2.9.1',
>>>>>>> feat/admin-panel-phase4
=======
>>>>>>> feat/admin-panel-phase5
}

export const Route = createFileRoute('/settings/general')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> feat/admin-panel-phase5
        queryKey: ['settings'],
        queryFn: () => apiClient.get<SettingsData>('/settings'),
      })
      .catch(() => ({}) as SettingsData),
  component: GeneralSettings,
})

function GeneralSettings() {
  const { t } = useTranslation('settings')

  const data = Route.useLoaderData()
  const isLoading = false

  return (
    <div className="space-y-6">
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
<<<<<<< HEAD
=======
        queryKey: ['settings', 'general'],
        queryFn: () => apiClient.get<GeneralSettingsResponse>('/settings/general'),
      })
      .catch(() => defaults),
  component: GeneralSettingsPage,
})

function GeneralSettingsPage() {
  const { t } = useTranslation('settings')
  const data = Route.useLoaderData() as GeneralSettings
  const queryClient = useQueryClient()

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<GeneralSettings>({
    resolver: zodResolver(generalSettingsSchema),
    defaultValues: data,
  })

  const saveMutation = useMutation({
    mutationFn: (values: GeneralSettings) =>
      apiClient.patch('/settings/general', {
        instanceName: values.instanceName,
        logLevel: values.logLevel,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'general'] })
      toast.success(t('actions.save'))
    },
    onError: () => toast.error('Failed to save settings'),
  })

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values))

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('general.title')}</CardTitle>
          <CardDescription>{t('general.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Instance name */}
            <SettingsField
              label={t('general.instanceName')}
              description={t('general.instanceNameDescription')}
              needsBackend
            >
              <Controller
                name="instanceName"
                control={control}
                render={({ field }) => (
                  <Input
                    {...field}
                    aria-invalid={!!errors.instanceName}
                  />
                )}
              />
              {errors.instanceName && (
                <p className="text-sm text-destructive mt-1">
                  {errors.instanceName.message}
                </p>
              )}
            </SettingsField>

            {/* Log level */}
            <SettingsField label={t('general.logLevel')}>
              <Controller
                name="logLevel"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
>>>>>>> feat/admin-panel-phase4
=======
>>>>>>> feat/admin-panel-phase5
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> feat/admin-panel-phase5
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
<<<<<<< HEAD
=======
                      <SelectItem value="debug">debug</SelectItem>
                      <SelectItem value="info">info</SelectItem>
                      <SelectItem value="warn">warn</SelectItem>
                      <SelectItem value="error">error</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </SettingsField>
          </div>

          {/* Read-only fields */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <SettingsField label={t('general.dataDirectory')} readOnly>
              <Input value={data.dataDirectory} readOnly className="font-mono" />
            </SettingsField>

            <SettingsField label={t('general.daemonVersion')} readOnly>
              <Input value={data.daemonVersion} readOnly className="font-mono" />
            </SettingsField>

            <SettingsField label={t('general.caddyVersion')} readOnly>
              <Input value={data.caddyVersion} readOnly className="font-mono" />
            </SettingsField>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => reset(data)}
          disabled={!isDirty}
        >
          <RotateCcwIcon className="size-3.5" data-icon="inline-start" />
          {t('actions.reset')}
        </Button>
        <Button type="submit" disabled={!isDirty || saveMutation.isPending}>
          <SaveIcon className="size-3.5" data-icon="inline-start" />
          {saveMutation.isPending ? t('actions.saving') : t('actions.save')}
        </Button>
      </div>
    </form>
>>>>>>> feat/admin-panel-phase4
=======
>>>>>>> feat/admin-panel-phase5
  )
}
