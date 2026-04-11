import { createFileRoute } from '@tanstack/react-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SaveIcon, RotateCcwIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { NetworkSettingsResponse } from '@/lib/api'
import {
  networkSettingsSchema,
  type NetworkSettings,
} from '@/lib/schemas/settings'
import { SettingsField } from '@/components/rioku/settings-field'
import { TagInput } from '@/components/rioku/tag-input'

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

const defaults: NetworkSettings = {
  trustedProxies: [],
  clientIpHeaders: ['X-Forwarded-For', 'X-Real-IP'],
  strictMode: false,
  listenAddresses: {
    grpc: ':7777',
    rest: ':7778',
    caddyHttp: ':80',
    caddyHttps: ':443',
    admin: ':2019',
  },
}

export const Route = createFileRoute('/settings/network')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['settings', 'network'],
        queryFn: () =>
          apiClient.get<NetworkSettingsResponse>('/settings/network'),
      })
      .catch(() => defaults),
  component: NetworkSettingsPage,
})

function NetworkSettingsPage() {
  const { t } = useTranslation('settings')
  const data = Route.useLoaderData() as NetworkSettings
  const queryClient = useQueryClient()

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<NetworkSettings>({
    resolver: zodResolver(networkSettingsSchema as any),
    defaultValues: data,
  })

  const saveMutation = useMutation({
    mutationFn: (values: NetworkSettings) =>
      apiClient.patch('/settings/network', {
        trustedProxies: values.trustedProxies,
        clientIpHeaders: values.clientIpHeaders,
        strictMode: values.strictMode,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'network'] })
      toast.success(t('actions.save'))
    },
    onError: () => toast.error('Failed to save network settings'),
  })

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values))

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('network.title')}</CardTitle>
          <CardDescription>{t('network.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Trusted proxies */}
          <SettingsField
            label={t('network.trustedProxies')}
            description={t('network.trustedProxiesDescription')}
            needsBackend
          >
            <Controller
              name="trustedProxies"
              control={control}
              render={({ field }) => (
                <TagInput
                  value={field.value}
                  onChange={field.onChange}
                  label={t('network.trustedProxies')}
                  placeholder={t('network.trustedProxiesPlaceholder')}
                />
              )}
            />
            {errors.trustedProxies && (
              <p className="text-sm text-destructive mt-1">
                {typeof errors.trustedProxies.message === 'string'
                  ? errors.trustedProxies.message
                  : 'Invalid CIDR entries'}
              </p>
            )}
          </SettingsField>

          {/* Client IP headers */}
          <SettingsField
            label={t('network.clientIpHeaders')}
            description={t('network.clientIpHeadersDescription')}
            needsBackend
          >
            <Controller
              name="clientIpHeaders"
              control={control}
              render={({ field }) => (
                <TagInput
                  value={field.value}
                  onChange={field.onChange}
                  label={t('network.clientIpHeaders')}
                  placeholder={t('network.clientIpHeadersPlaceholder')}
                />
              )}
            />
          </SettingsField>

          {/* Strict mode */}
          <SettingsField
            label={t('network.strictMode')}
            description={t('network.strictModeDescription')}
            needsBackend
          >
            <Controller
              name="strictMode"
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-3">
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                  <Label className="text-sm text-muted-foreground">
                    {field.value ? 'Enabled' : 'Disabled'}
                  </Label>
                </div>
              )}
            />
          </SettingsField>

          {/* Listening addresses (read-only) */}
          <SettingsField label={t('network.listenAddresses')} readOnly>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ['grpc', t('network.grpc')],
                  ['rest', t('network.rest')],
                  ['caddyHttp', t('network.caddyHttp')],
                  ['caddyHttps', t('network.caddyHttps')],
                  ['admin', t('network.admin')],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {label}
                  </Label>
                  <Input
                    value={data.listenAddresses[key]}
                    readOnly
                    className="font-mono"
                  />
                </div>
              ))}
            </div>
          </SettingsField>
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
