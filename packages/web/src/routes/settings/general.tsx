import { createFileRoute } from '@tanstack/react-router'
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
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Realistic defaults for when backend API is not wired
const defaults: GeneralSettings = {
  instanceName: 'rioku-gateway',
  dataDirectory: '/var/lib/rioku',
  logLevel: 'info',
  daemonVersion: '0.3.0',
  caddyVersion: '2.9.1',
}

export const Route = createFileRoute('/settings/general')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
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
  )
}
