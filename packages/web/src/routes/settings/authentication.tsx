import { createFileRoute } from '@tanstack/react-router'
<<<<<<< HEAD
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SaveIcon, RotateCcwIcon, InfoIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { AuthSettingsResponse } from '@/lib/api'
import {
  authSettingsSchema,
  type AuthSettings,
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
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'

const defaults: AuthSettings = {
  sessionCookieLifetime: '24h',
  sessionIdleTimeout: '30m',
  maxConcurrentSessions: 5,
  passwordMinLength: 12,
  passwordRequireUppercase: true,
  passwordRequireLowercase: true,
  passwordRequireNumber: true,
  passwordRequireSpecial: false,
  passwordMaxAgeDays: 90,
  lockoutMaxAttempts: 5,
  lockoutDuration: '15m',
  lockoutResetWindow: '1h',
  totpIssuerName: 'Rioku Gateway',
  totpEnforceForAll: false,
  bruteForceRateLimit: 10,
}

export const Route = createFileRoute('/settings/authentication')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['settings', 'authentication'],
        queryFn: () =>
          apiClient.get<AuthSettingsResponse>('/settings/authentication'),
      })
      .catch(() => defaults),
  component: AuthenticationSettingsPage,
})

function AuthenticationSettingsPage() {
  const { t } = useTranslation('settings')
  const data = Route.useLoaderData() as AuthSettings
  const queryClient = useQueryClient()

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<AuthSettings>({
    resolver: zodResolver(authSettingsSchema),
    defaultValues: data,
  })

  const saveMutation = useMutation({
    mutationFn: (values: AuthSettings) =>
      apiClient.patch('/settings/authentication', values),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['settings', 'authentication'],
      })
      toast.success(t('actions.save'))
    },
    onError: () => toast.error('Failed to save authentication settings'),
  })

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values))

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('authentication.title')}</CardTitle>
          <CardDescription>
            {t('authentication.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* SSO notice */}
          <Alert>
            <InfoIcon className="size-4" />
            <AlertDescription>
              {t('authentication.ssoNote')}
            </AlertDescription>
          </Alert>

          {/* Session settings */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('authentication.sessions')}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <SettingsField
                label={t('authentication.cookieLifetime')}
                needsBackend
              >
                <Controller
                  name="sessionCookieLifetime"
                  control={control}
                  render={({ field }) => <Input {...field} />}
                />
              </SettingsField>
              <SettingsField
                label={t('authentication.idleTimeout')}
                needsBackend
              >
                <Controller
                  name="sessionIdleTimeout"
                  control={control}
                  render={({ field }) => <Input {...field} />}
                />
              </SettingsField>
              <SettingsField
                label={t('authentication.maxConcurrentSessions')}
                needsBackend
              >
                <Controller
                  name="maxConcurrentSessions"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  )}
                />
              </SettingsField>
            </div>
          </div>

          <Separator />

          {/* Password policy */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('authentication.passwordPolicy')}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SettingsField
                label={t('authentication.minLength')}
                needsBackend
              >
                <Controller
                  name="passwordMinLength"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  )}
                />
                {errors.passwordMinLength && (
                  <p className="text-sm text-destructive mt-1">
                    {errors.passwordMinLength.message}
                  </p>
                )}
              </SettingsField>
              <SettingsField
                label={t('authentication.maxAgeDays')}
                needsBackend
              >
                <Controller
                  name="passwordMaxAgeDays"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  )}
                />
              </SettingsField>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4 sm:grid-cols-4">
              {(
                [
                  ['passwordRequireUppercase', t('authentication.requireUppercase')],
                  ['passwordRequireLowercase', t('authentication.requireLowercase')],
                  ['passwordRequireNumber', t('authentication.requireNumber')],
                  ['passwordRequireSpecial', t('authentication.requireSpecial')],
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
          </div>

          <Separator />

          {/* Account lockout */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('authentication.lockout')}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <SettingsField
                label={t('authentication.maxAttempts')}
                needsBackend
              >
                <Controller
                  name="lockoutMaxAttempts"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  )}
                />
              </SettingsField>
              <SettingsField
                label={t('authentication.lockoutDuration')}
                needsBackend
              >
                <Controller
                  name="lockoutDuration"
                  control={control}
                  render={({ field }) => <Input {...field} />}
                />
              </SettingsField>
              <SettingsField
                label={t('authentication.resetWindow')}
                needsBackend
              >
                <Controller
                  name="lockoutResetWindow"
                  control={control}
                  render={({ field }) => <Input {...field} />}
                />
              </SettingsField>
            </div>
          </div>

          <Separator />

          {/* TOTP 2FA */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('authentication.totp')}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SettingsField
                label={t('authentication.totpIssuerName')}
                needsBackend
              >
                <Controller
                  name="totpIssuerName"
                  control={control}
                  render={({ field }) => <Input {...field} />}
                />
              </SettingsField>
              <SettingsField
                label={t('authentication.totpEnforceForAll')}
                needsBackend
              >
                <Controller
                  name="totpEnforceForAll"
                  control={control}
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </SettingsField>
            </div>
          </div>

          <Separator />

          {/* Brute-force protection */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('authentication.bruteForce')}
            </h3>
            <SettingsField
              label={t('authentication.bruteForceRateLimit')}
              needsBackend
            >
              <Controller
                name="bruteForceRateLimit"
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
=======
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/settings/authentication')({
  component: AuthenticationSettings,
})

function AuthenticationSettings() {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t('nav.authentication')}</h2>
      <p className="text-muted-foreground">{t('placeholders.authentication')}</p>
    </div>
>>>>>>> feat/admin-panel-phase5
  )
}
