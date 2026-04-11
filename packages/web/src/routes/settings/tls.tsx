import { createFileRoute } from '@tanstack/react-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  SaveIcon,
  RotateCcwIcon,
  RefreshCwIcon,
  ShieldOffIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { TlsSettingsResponse, CertificateInfo } from '@/lib/api'
import {
  tlsSettingsSchema,
  type TlsSettings,
} from '@/lib/schemas/settings'
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
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// DNS challenge provider credential fields
const dnsProviderFields: Record<string, { label: string; placeholder: string }[]> = {
  cloudflare: [
    { label: 'API Token', placeholder: 'CF API token' },
  ],
  route53: [
    { label: 'Access Key ID', placeholder: 'AWS access key' },
    { label: 'Secret Access Key', placeholder: 'AWS secret key' },
    { label: 'Region', placeholder: 'us-east-1' },
  ],
  gcloud: [
    { label: 'Project ID', placeholder: 'my-gcp-project' },
    { label: 'Service Account JSON', placeholder: 'Paste JSON key...' },
  ],
  azure: [
    { label: 'Tenant ID', placeholder: 'Azure tenant ID' },
    { label: 'Client ID', placeholder: 'Azure client ID' },
    { label: 'Client Secret', placeholder: 'Azure client secret' },
    { label: 'Subscription ID', placeholder: 'Azure subscription ID' },
    { label: 'Resource Group', placeholder: 'DNS resource group' },
  ],
  digitalocean: [
    { label: 'API Token', placeholder: 'DO API token' },
  ],
}

const defaults: TlsSettings & { certificates: CertificateInfo[] } = {
  acmeProvider: 'letsencrypt',
  dnsChallengeProvider: 'none',
  dnsChallengeCredentials: {},
  onDemandTls: false,
  onDemandRateInterval: '2m',
  onDemandRateBurst: 5,
  defaultMinTlsVersion: '1.2',
  certificates: [
    {
      id: 'cert-1',
      domain: '*.example.com',
      issuer: "Let's Encrypt",
      expiresAt: '2026-07-10T00:00:00Z',
      issuedAt: '2026-01-10T00:00:00Z',
      status: 'valid',
      sans: ['*.example.com'],
      serialNumber: '01:AB:CD:EF',
      fingerprint: 'SHA256:aa:bb:cc',
      autoRenew: true,
    },
    {
      id: 'cert-2',
      domain: 'api.example.com',
      issuer: "Let's Encrypt",
      expiresAt: '2026-05-01T00:00:00Z',
      issuedAt: '2026-02-01T00:00:00Z',
      status: 'expiring',
      sans: ['api.example.com'],
      serialNumber: '02:AB:CD:EF',
      fingerprint: 'SHA256:dd:ee:ff',
      autoRenew: true,
    },
  ],
}

export const Route = createFileRoute('/settings/tls')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['settings', 'tls'],
        queryFn: () => apiClient.get<TlsSettingsResponse>('/settings/tls'),
      })
      .catch(() => defaults),
  component: TlsSettingsPage,
})

const certStatusMap: Record<
  CertificateInfo['status'],
  'healthy' | 'degraded' | 'unhealthy' | 'unknown'
> = {
  valid: 'healthy',
  expiring: 'degraded',
  expired: 'unhealthy',
  revoked: 'unhealthy',
  pending: 'unknown',
}

function TlsSettingsPage() {
  const { t } = useTranslation('settings')
  const rawData = Route.useLoaderData() as TlsSettings & {
    certificates: CertificateInfo[]
  }
  const { certificates, ...formData } = rawData
  const queryClient = useQueryClient()

  const {
    control,
    handleSubmit,
    watch,
    reset,
    formState: { isDirty },
  } = useForm<TlsSettings>({
    resolver: zodResolver(tlsSettingsSchema as any),
    defaultValues: formData,
  })

  const selectedDnsProvider = watch('dnsChallengeProvider')
  const onDemandEnabled = watch('onDemandTls')

  const saveMutation = useMutation({
    mutationFn: (values: TlsSettings) =>
      apiClient.patch('/settings/tls', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'tls'] })
      toast.success(t('actions.save'))
    },
    onError: () => toast.error('Failed to save TLS settings'),
  })

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values))

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* ACME & TLS settings */}
      <Card>
        <CardHeader>
          <CardTitle>{t('tls.title')}</CardTitle>
          <CardDescription>{t('tls.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <SettingsField label={t('tls.acmeProvider')} needsBackend>
              <Controller
                name="acmeProvider"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="letsencrypt">Let&apos;s Encrypt</SelectItem>
                      <SelectItem value="zerossl">ZeroSSL</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </SettingsField>

            <SettingsField label={t('tls.defaultMinTlsVersion')} needsBackend>
              <Controller
                name="defaultMinTlsVersion"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1.2">TLS 1.2</SelectItem>
                      <SelectItem value="1.3">TLS 1.3</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </SettingsField>
          </div>

          {/* DNS challenge provider */}
          <SettingsField label={t('tls.dnsChallengeProvider')} needsBackend>
            <Controller
              name="dnsChallengeProvider"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="cloudflare">Cloudflare</SelectItem>
                    <SelectItem value="route53">AWS Route 53</SelectItem>
                    <SelectItem value="gcloud">Google Cloud DNS</SelectItem>
                    <SelectItem value="azure">Azure DNS</SelectItem>
                    <SelectItem value="digitalocean">DigitalOcean</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </SettingsField>

          {/* DNS provider credentials (conditional) */}
          {selectedDnsProvider !== 'none' &&
            dnsProviderFields[selectedDnsProvider] && (
              <SettingsField
                label={t('tls.dnsChallengeCredentials')}
                needsBackend
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {dnsProviderFields[selectedDnsProvider].map((cred) => (
                    <div key={cred.label} className="space-y-1">
                      <Label className="text-xs">{cred.label}</Label>
                      <Input
                        type="password"
                        placeholder={cred.placeholder}
                        disabled
                      />
                    </div>
                  ))}
                </div>
              </SettingsField>
            )}

          {/* On-demand TLS */}
          <SettingsField
            label={t('tls.onDemandTls')}
            description={t('tls.onDemandTlsDescription')}
            needsBackend
          >
            <Controller
              name="onDemandTls"
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

          {onDemandEnabled && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pl-4 border-l-2 border-muted">
              <SettingsField label={t('tls.onDemandRateInterval')} needsBackend>
                <Controller
                  name="onDemandRateInterval"
                  control={control}
                  render={({ field }) => (
                    <Input {...field} value={field.value ?? ''} />
                  )}
                />
              </SettingsField>
              <SettingsField label={t('tls.onDemandRateBurst')} needsBackend>
                <Controller
                  name="onDemandRateBurst"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="number"
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active certificates table */}
      <Card>
        <CardHeader>
          <CardTitle>{t('tls.certificates')}</CardTitle>
        </CardHeader>
        <CardContent>
          {certificates.length === 0 ? (
            <EmptyState
              icon={<ShieldOffIcon className="size-5" />}
              title={t('tls.noCertificates')}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('tls.domain')}</TableHead>
                    <TableHead>{t('tls.issuer')}</TableHead>
                    <TableHead>{t('tls.expires')}</TableHead>
                    <TableHead>{t('tls.status')}</TableHead>
                    <TableHead className="text-right">{t('tls.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certificates.map((cert) => (
                    <TableRow key={cert.domain}>
                      <TableCell className="font-mono text-sm">
                        {cert.domain}
                      </TableCell>
                      <TableCell>{cert.issuer}</TableCell>
                      <TableCell>
                        <TimeAgo date={cert.expiresAt} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={certStatusMap[cert.status]}
                          label={cert.status}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" title={t('tls.forceRenew')}>
                            <RefreshCwIcon className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={t('tls.revoke')}
                            className="text-destructive hover:text-destructive"
                          >
                            <ShieldOffIcon className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => reset(formData)}
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
