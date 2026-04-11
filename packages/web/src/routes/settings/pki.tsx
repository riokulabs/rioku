import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  SaveIcon,
  RotateCcwIcon,
  DownloadIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { z } from 'zod'

import { apiClient } from '@/lib/api'
import type { PkiSettingsResponse, RotationHistoryInfo } from '@/lib/api'
import { SettingsField } from '@/components/rioku/settings-field'
import { StatusBadge } from '@/components/rioku/status-badge'
import { EmptyState } from '@/components/rioku/empty-state'
import { TimeAgo } from '@/components/rioku/time-ago'
import { TypedConfirmationDialog } from '@/components/rioku/typed-confirmation-dialog'

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
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const editableSchema = z.object({
  autoRotationThresholdDays: z.number().int().min(1),
})
type EditablePki = z.infer<typeof editableSchema>

const defaults: PkiSettingsResponse = {
  caAlgorithm: 'ecdsa-p256',
  caValidityDays: 3650,
  caExpiresAt: '2036-04-10T00:00:00Z',
  caFingerprint: 'SHA256:2c:f3:a1:...:9e:b4',
  nodeCertExpiresAt: '2027-04-10T00:00:00Z',
  nodeCertSans: ['node-1.rioku.local', '127.0.0.1'],
  autoRotationThresholdDays: 30,
  dbClientCertStatus: 'healthy',
  rotationHistory: [
    {
      id: 'rot-1',
      type: 'ca',
      rotatedAt: '2026-01-15T10:00:00Z',
      reason: 'Initial CA creation',
      actor: 'system',
    },
    {
      id: 'rot-2',
      type: 'node',
      rotatedAt: '2026-03-01T08:30:00Z',
      reason: 'Auto-rotation threshold reached',
      actor: 'system',
    },
  ],
}

export const Route = createFileRoute('/settings/pki')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['settings', 'pki'],
        queryFn: () => apiClient.get<PkiSettingsResponse>('/settings/pki'),
      })
      .catch(() => defaults),
  component: PkiSettingsPage,
})

const rotationTypeLabels: Record<RotationHistoryInfo['type'], string> = {
  ca: 'CA',
  node: 'Node',
  'db-client': 'DB Client',
}

function PkiSettingsPage() {
  const { t } = useTranslation('settings')
  const data = Route.useLoaderData() as PkiSettingsResponse
  const queryClient = useQueryClient()
  const [forceRotateOpen, setForceRotateOpen] = useState(false)

  const {
    control,
    handleSubmit,
    reset,
    formState: { isDirty },
  } = useForm<EditablePki>({
    resolver: zodResolver(editableSchema),
    defaultValues: {
      autoRotationThresholdDays: data.autoRotationThresholdDays,
    },
  })

  const saveMutation = useMutation({
    mutationFn: (values: EditablePki) =>
      apiClient.patch('/settings/pki', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'pki'] })
      toast.success(t('actions.save'))
    },
    onError: () => toast.error('Failed to save PKI settings'),
  })

  const rotateMutation = useMutation({
    mutationFn: () => apiClient.post('/pki/rotate'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'pki'] })
      toast.success('Certificate rotation initiated')
      setForceRotateOpen(false)
    },
    onError: () => toast.error('Failed to initiate rotation (needs backend)'),
  })

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values))

  const healthMap: Record<string, 'healthy' | 'degraded' | 'unhealthy' | 'unknown'> = {
    healthy: 'healthy', degraded: 'degraded',
    unhealthy: 'unhealthy', unknown: 'unknown',
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('pki.title')}</CardTitle>
          <CardDescription>{t('pki.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* CA Status */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('pki.caStatus')}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SettingsField label={t('pki.caAlgorithm')} readOnly>
                <Input value={data.caAlgorithm} readOnly className="font-mono" />
              </SettingsField>
              <SettingsField label={t('pki.caValidity')} readOnly>
                <Input
                  value={`${data.caValidityDays} days`}
                  readOnly
                  className="font-mono"
                />
              </SettingsField>
              <SettingsField label={t('pki.caExpires')} readOnly>
                <div className="flex h-9 items-center">
                  <TimeAgo date={data.caExpiresAt} />
                </div>
              </SettingsField>
              <SettingsField label={t('pki.caFingerprint')} readOnly>
                <Input
                  value={data.caFingerprint}
                  readOnly
                  className="font-mono text-xs"
                />
              </SettingsField>
            </div>
          </div>

          <Separator />

          {/* Node cert */}
          <div>
            <h3 className="text-sm font-semibold mb-4">
              {t('pki.nodeCert')}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SettingsField label={t('pki.nodeCertExpires')} readOnly>
                <div className="flex h-9 items-center">
                  <TimeAgo date={data.nodeCertExpiresAt} />
                </div>
              </SettingsField>
              <SettingsField label={t('pki.nodeCertSans')} readOnly>
                <div className="flex flex-wrap gap-1.5">
                  {data.nodeCertSans.map((san) => (
                    <Badge key={san} variant="secondary" className="font-mono text-xs">
                      {san}
                    </Badge>
                  ))}
                </div>
              </SettingsField>
            </div>
          </div>

          <Separator />

          {/* Auto-rotation threshold (editable) */}
          <SettingsField
            label={t('pki.autoRotationThreshold')}
            needsBackend
          >
            <Controller
              name="autoRotationThresholdDays"
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

          {/* DB client cert */}
          <SettingsField label={t('pki.dbClientCertStatus')} readOnly>
            <div className="flex h-9 items-center">
              <StatusBadge
                status={healthMap[data.dbClientCertStatus] ?? 'unknown'}
              />
            </div>
          </SettingsField>
        </CardContent>
      </Card>

      {/* Rotation history */}
      <Card>
        <CardHeader>
          <CardTitle>{t('pki.rotationHistory')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.rotationHistory.length === 0 ? (
            <EmptyState title={t('pki.noRotations')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('pki.rotationType')}</TableHead>
                    <TableHead>{t('pki.rotatedAt')}</TableHead>
                    <TableHead>{t('pki.rotationReason')}</TableHead>
                    <TableHead>{t('pki.rotationActor')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rotationHistory.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <Badge variant="secondary">
                          {rotationTypeLabels[entry.type]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <TimeAgo date={entry.rotatedAt} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {entry.reason}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {entry.actor}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setForceRotateOpen(true)}
          >
            <RefreshCwIcon className="size-3.5" data-icon="inline-start" />
            {t('pki.forceRotation')}
          </Button>
          <Button type="button" variant="outline" disabled>
            <DownloadIcon className="size-3.5" data-icon="inline-start" />
            {t('pki.downloadCaCert')}
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              reset({ autoRotationThresholdDays: data.autoRotationThresholdDays })
            }
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
      </div>

      <TypedConfirmationDialog
        open={forceRotateOpen}
        onOpenChange={setForceRotateOpen}
        title={t('pki.forceRotation')}
        description={t('pki.forceRotationDescription')}
        confirmPhrase="rotate certificates"
        confirmLabel="Rotate now"
        onConfirm={() => rotateMutation.mutate()}
        loading={rotateMutation.isPending}
      />
    </form>
  )
}
