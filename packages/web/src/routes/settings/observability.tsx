import { createFileRoute } from '@tanstack/react-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SaveIcon, RotateCcwIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ObservabilitySettingsResponse } from '@/lib/api'
import {
  observabilitySettingsSchema,
  type ObservabilitySettings,
} from '@/lib/schemas/settings'
import { SettingsField } from '@/components/rioku/settings-field'
import { TagInput } from '@/components/rioku/tag-input'
import { ProgressBar } from '@/components/rioku/progress-bar'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

const defaults: ObservabilitySettings = {
  traceSamplingRate: 100,
  alwaysTraceErrors: true,
  alwaysTraceAi: true,
  alwaysTraceSlowRequests: false,
  slowRequestThresholdMs: 3000,
  retentionRawTraces: '7d',
  retentionAggregatedStats: '90d',
  retentionAiSessions: '30d',
  storageBackend: 'sqlite',
  storageUsedBytes: 536870912,
  storageMaxBytes: 2147483648,
  ipMasking: false,
  ipMaskPrefixLength: 24,
  queryParamRedaction: ['password', 'token', 'secret'],
  cookieRedaction: ['session_id'],
  customPiiRegexes: [],
  prometheusEnabled: false,
  otelExporterEndpoint: '',
}

export const Route = createFileRoute('/settings/observability')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['settings', 'observability'],
        queryFn: () =>
          apiClient.get<ObservabilitySettingsResponse>(
            '/settings/observability',
          ),
      })
      .catch(() => defaults),
  component: ObservabilitySettingsPage,
})

function ObservabilitySettingsPage() {
  const { t } = useTranslation('settings')
  const data = Route.useLoaderData() as ObservabilitySettings
  const queryClient = useQueryClient()

  const {
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isDirty },
  } = useForm<ObservabilitySettings>({
    resolver: zodResolver(observabilitySettingsSchema as any),
    defaultValues: data,
  })

  const ipMaskingEnabled = watch('ipMasking')

  const saveMutation = useMutation({
    mutationFn: (values: ObservabilitySettings) =>
      apiClient.patch('/settings/observability', values),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['settings', 'observability'],
      })
      toast.success(t('actions.save'))
    },
    onError: () => toast.error('Failed to save observability settings'),
  })

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values))

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Trace sampling */}
      <Card>
        <CardHeader>
          <CardTitle>{t('observability.title')}</CardTitle>
          <CardDescription>{t('observability.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Sampling rate slider */}
          <SettingsField label={t('observability.traceSampling')} needsBackend>
            <Controller
              name="traceSamplingRate"
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={field.value}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="w-12 text-right font-mono text-sm">
                    {field.value}%
                  </span>
                </div>
              )}
            />
            {errors.traceSamplingRate && (
              <p className="text-sm text-destructive mt-1">
                {errors.traceSamplingRate.message}
              </p>
            )}
          </SettingsField>

          {/* Always-trace toggles */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(
              [
                ['alwaysTraceErrors', t('observability.alwaysTraceErrors')],
                ['alwaysTraceAi', t('observability.alwaysTraceAi')],
                [
                  'alwaysTraceSlowRequests',
                  t('observability.alwaysTraceSlowRequests'),
                ],
              ] as const
            ).map(([name, label]) => (
              <SettingsField key={name} label={label} needsBackend>
                <Controller
                  name={name}
                  control={control}
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </SettingsField>
            ))}
          </div>

          {/* Slow request threshold */}
          <SettingsField
            label={t('observability.slowRequestThreshold')}
            needsBackend
          >
            <Controller
              name="slowRequestThresholdMs"
              control={control}
              render={({ field }) => (
                <Input
                  type="number"
                  className="max-w-xs"
                  {...field}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              )}
            />
          </SettingsField>

          <Separator />

          {/* Retention settings */}
          <SettingsField label={t('observability.retention')} needsBackend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(
                [
                  ['retentionRawTraces', t('observability.retentionRawTraces')],
                  [
                    'retentionAggregatedStats',
                    t('observability.retentionAggregatedStats'),
                  ],
                  [
                    'retentionAiSessions',
                    t('observability.retentionAiSessions'),
                  ],
                ] as const
              ).map(([name, label]) => (
                <div key={name} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {label}
                  </Label>
                  <Controller
                    name={name}
                    control={control}
                    render={({ field }) => <Input {...field} />}
                  />
                </div>
              ))}
            </div>
          </SettingsField>

          {/* Storage usage */}
          <SettingsField label={t('observability.storageUsage')} readOnly>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {t('observability.storageBackend')}: {data.storageBackend}
              </div>
              <ProgressBar
                value={data.storageUsedBytes}
                max={data.storageMaxBytes}
                label={t('observability.storage')}
                formatValue={formatBytes}
              />
            </div>
          </SettingsField>

          <Separator />

          {/* PII Filters */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">
              {t('observability.piiFilters')}
            </h3>

            <SettingsField label={t('observability.ipMasking')} needsBackend>
              <Controller
                name="ipMasking"
                control={control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </SettingsField>

            {ipMaskingEnabled && (
              <SettingsField
                label={t('observability.ipMaskPrefixLength')}
                needsBackend
                className="pl-4 border-l-2 border-muted"
              >
                <Controller
                  name="ipMaskPrefixLength"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      className="max-w-xs"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value ? Number(e.target.value) : undefined,
                        )
                      }
                    />
                  )}
                />
              </SettingsField>
            )}

            <SettingsField
              label={t('observability.queryParamRedaction')}
              needsBackend
            >
              <Controller
                name="queryParamRedaction"
                control={control}
                render={({ field }) => (
                  <TagInput
                    value={field.value}
                    onChange={field.onChange}
                    label={t('observability.queryParamRedaction')}
                    placeholder={t(
                      'observability.queryParamRedactionPlaceholder',
                    )}
                  />
                )}
              />
            </SettingsField>

            <SettingsField
              label={t('observability.cookieRedaction')}
              needsBackend
            >
              <Controller
                name="cookieRedaction"
                control={control}
                render={({ field }) => (
                  <TagInput
                    value={field.value}
                    onChange={field.onChange}
                    label={t('observability.cookieRedaction')}
                    placeholder={t(
                      'observability.cookieRedactionPlaceholder',
                    )}
                  />
                )}
              />
            </SettingsField>

            <SettingsField
              label={t('observability.customPiiRegexes')}
              needsBackend
            >
              <Controller
                name="customPiiRegexes"
                control={control}
                render={({ field }) => (
                  <TagInput
                    value={field.value}
                    onChange={field.onChange}
                    label={t('observability.customPiiRegexes')}
                    placeholder={t(
                      'observability.customPiiRegexesPlaceholder',
                    )}
                  />
                )}
              />
            </SettingsField>
          </div>

          <Separator />

          {/* Prometheus & OTEL */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <SettingsField
              label={t('observability.prometheus')}
              description={t('observability.prometheusDescription')}
              needsBackend
            >
              <Controller
                name="prometheusEnabled"
                control={control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </SettingsField>

            <SettingsField
              label={t('observability.otelExporter')}
              needsBackend
            >
              <Controller
                name="otelExporterEndpoint"
                control={control}
                render={({ field }) => (
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    placeholder={t(
                      'observability.otelExporterPlaceholder',
                    )}
                  />
                )}
              />
            </SettingsField>
          </div>
        </CardContent>
      </Card>

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
  )
}
