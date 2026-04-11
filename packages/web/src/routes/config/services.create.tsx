import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeftIcon, PlusIcon, XIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot } from '@/lib/api'
import {
  serviceFormSchema,
  formValuesToServicePayload,
  LB_POLICY_LABELS,
  TLS_MODE_LABELS,
} from '@/lib/schemas/service'
import type { ServiceFormValues } from '@/lib/schemas/service'
import { useServiceMutations } from '@/hooks/use-config-mutations'
import { useDirtyForm } from '@/hooks/use-dirty-form'
import { useUnsavedWarning } from '@/hooks/use-unsaved-warning'

import { PageHeader } from '@/components/rioku/page-header'
import { NeedsBackendField } from '@/components/rioku/needs-backend-field'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const Route = createFileRoute('/config/services/create')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    }),
  component: ServiceCreatePage,
})

const EMPTY_FORM: ServiceFormValues = {
  name: '',
  lbPolicy: 'LB_POLICY_ROUND_ROBIN',
  upstreams: [{ address: '', weight: 1, tls: 'TLS_MODE_OFF' }],
  activeHealthCheck: {
    enabled: false,
    path: '/health',
    intervalSeconds: 10,
    timeoutSeconds: 5,
    healthyThreshold: 2,
    unhealthyThreshold: 3,
    expectedStatuses: [200],
  },
  passiveHealthCheck: {
    enabled: false,
    failureWindow: '',
    maxFailures: 5,
    latencyThreshold: '',
    unhealthyStatuses: [],
  },
  timeouts: { dial: '', responseHeader: '', idle: '' },
  retries: { maxAttempts: 0, retryStatuses: [] },
  connectionPool: { maxConnsPerHost: 0, maxIdleConns: 0, keepAliveInterval: '' },
  labels: {},
}

function ServiceCreatePage() {
  const { t } = useTranslation('services')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()

  const { saveMutation } = useServiceMutations()

  const [mode, setMode] = useState<'form' | 'code'>('form')
  const [formValues, setFormValues] = useState<ServiceFormValues>(EMPTY_FORM)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    general: true,
    upstreams: true,
    activeHealth: true,
    passiveHealth: false,
    timeouts: false,
    retries: false,
    connectionPool: false,
    labels: false,
  })

  const { isDirty } = useDirtyForm(EMPTY_FORM, formValues)
  useUnsavedWarning(isDirty)

  function toggleSection(key: string) {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function handleCreate() {
    const validation = serviceFormSchema.safeParse(formValues)
    if (!validation.success) {
      toast.error(validation.error.issues[0].message)
      return
    }
    const payload = formValuesToServicePayload(formValues)
    saveMutation.mutate(payload, {
      onSuccess: () => {
        toast.success(t('messages.serviceCreated'))
        navigate({ to: '/config/services' })
      },
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" render={<Link to="/config/services" />}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <PageHeader
          title={t('create.title')}
          description={t('create.subtitle')}
        />
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={mode === 'form' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('form')}
        >
          {t('create.formMode')}
        </Button>
        <Button
          variant={mode === 'code' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('code')}
        >
          {t('create.codeMode')}
        </Button>
      </div>

      {mode === 'form' ? (
        <div className="space-y-4">
          {/* General */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('general')}>
              <CardTitle className="text-base">{t('create.sectionGeneral')}</CardTitle>
            </CardHeader>
            {expandedSections.general && (
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>
                    {t('form.serviceName')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={formValues.name}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder={t('form.serviceNamePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('form.lbPolicy')}</Label>
                  <Select
                    value={formValues.lbPolicy}
                    onValueChange={(val) =>
                      setFormValues((prev) => ({ ...prev, lbPolicy: val as ServiceFormValues['lbPolicy'] }))
                    }
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(LB_POLICY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Upstreams */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('upstreams')}>
              <CardTitle className="text-base">{t('create.sectionUpstreams')}</CardTitle>
            </CardHeader>
            {expandedSections.upstreams && (
              <CardContent className="space-y-3">
                {formValues.upstreams.map((upstream, idx) => (
                  <div key={idx} className="flex items-start gap-2 rounded-lg border p-3">
                    <div className="flex-1 space-y-2">
                      <div className="space-y-1">
                        <Label className="text-xs">{t('form.address')}</Label>
                        <Input
                          value={upstream.address}
                          onChange={(e) => {
                            const next = [...formValues.upstreams]
                            next[idx] = { ...next[idx], address: e.target.value }
                            setFormValues((prev) => ({ ...prev, upstreams: next }))
                          }}
                          placeholder={t('form.addressPlaceholder')}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">{t('form.weight')}</Label>
                          <Input
                            type="number"
                            min={0}
                            value={upstream.weight}
                            onChange={(e) => {
                              const next = [...formValues.upstreams]
                              next[idx] = { ...next[idx], weight: parseInt(e.target.value, 10) || 0 }
                              setFormValues((prev) => ({ ...prev, upstreams: next }))
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{t('form.tlsMode')}</Label>
                          <Select
                            value={upstream.tls}
                            onValueChange={(val) => {
                              const next = [...formValues.upstreams]
                              next[idx] = { ...next[idx], tls: val as typeof upstream.tls }
                              setFormValues((prev) => ({ ...prev, upstreams: next }))
                            }}
                          >
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(TLS_MODE_LABELS).map(([v, l]) => (
                                <SelectItem key={v} value={v}>{l}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    {formValues.upstreams.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          const next = formValues.upstreams.filter((_, i) => i !== idx)
                          setFormValues((prev) => ({ ...prev, upstreams: next }))
                        }}
                        className="mt-5 shrink-0"
                      >
                        <XIcon className="size-3" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setFormValues((prev) => ({
                      ...prev,
                      upstreams: [...prev.upstreams, { address: '', weight: 1, tls: 'TLS_MODE_OFF' }],
                    }))
                  }
                >
                  <PlusIcon className="size-3" />
                  {t('form.addUpstream')}
                </Button>
              </CardContent>
            )}
          </Card>

          {/* Active health checks */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('activeHealth')}>
              <CardTitle className="text-base">{t('create.sectionActiveHealth')}</CardTitle>
            </CardHeader>
            {expandedSections.activeHealth && (
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t('healthChecks.enabled')}</Label>
                  <Switch
                    checked={formValues.activeHealthCheck.enabled}
                    onCheckedChange={(checked) =>
                      setFormValues((prev) => ({
                        ...prev,
                        activeHealthCheck: { ...prev.activeHealthCheck, enabled: checked },
                      }))
                    }
                  />
                </div>
                {formValues.activeHealthCheck.enabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.path')}</Label>
                      <Input
                        value={formValues.activeHealthCheck.path}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            activeHealthCheck: { ...prev.activeHealthCheck, path: e.target.value },
                          }))
                        }
                        placeholder={t('healthChecks.pathPlaceholder')}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.interval')}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={formValues.activeHealthCheck.intervalSeconds}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            activeHealthCheck: {
                              ...prev.activeHealthCheck,
                              intervalSeconds: parseInt(e.target.value, 10) || 0,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.timeout')}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={formValues.activeHealthCheck.timeoutSeconds}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            activeHealthCheck: {
                              ...prev.activeHealthCheck,
                              timeoutSeconds: parseInt(e.target.value, 10) || 0,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.healthyThreshold')}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={formValues.activeHealthCheck.healthyThreshold}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            activeHealthCheck: {
                              ...prev.activeHealthCheck,
                              healthyThreshold: parseInt(e.target.value, 10) || 0,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.unhealthyThreshold')}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={formValues.activeHealthCheck.unhealthyThreshold}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            activeHealthCheck: {
                              ...prev.activeHealthCheck,
                              unhealthyThreshold: parseInt(e.target.value, 10) || 0,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* Passive health checks (collapsed, NEEDS BACKEND) */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('passiveHealth')}>
              <CardTitle className="text-base">{t('create.sectionPassiveHealth')}</CardTitle>
            </CardHeader>
            {expandedSections.passiveHealth && (
              <CardContent>
                <NeedsBackendField>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.failureWindow')}</Label>
                      <Input disabled placeholder="30s" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.maxFailures')}</Label>
                      <Input type="number" disabled placeholder="5" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.latencyThreshold')}</Label>
                      <Input disabled placeholder="2000ms" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('healthChecks.unhealthyStatuses')}</Label>
                      <Input disabled placeholder="502, 503, 504" />
                    </div>
                  </div>
                </NeedsBackendField>
              </CardContent>
            )}
          </Card>

          {/* Timeouts (collapsed, NEEDS BACKEND) */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('timeouts')}>
              <CardTitle className="text-base">{t('create.sectionTimeouts')}</CardTitle>
            </CardHeader>
            {expandedSections.timeouts && (
              <CardContent>
                <NeedsBackendField>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.dialTimeout')}</Label>
                      <Input disabled placeholder="5s" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.responseHeaderTimeout')}</Label>
                      <Input disabled placeholder="30s" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.idleTimeout')}</Label>
                      <Input disabled placeholder="90s" />
                    </div>
                  </div>
                </NeedsBackendField>
              </CardContent>
            )}
          </Card>

          {/* Retries (collapsed, NEEDS BACKEND) */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('retries')}>
              <CardTitle className="text-base">{t('create.sectionRetries')}</CardTitle>
            </CardHeader>
            {expandedSections.retries && (
              <CardContent>
                <NeedsBackendField>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.maxRetries')}</Label>
                      <Input type="number" disabled placeholder="3" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.retryStatuses')}</Label>
                      <Input disabled placeholder="502, 503, 504" />
                    </div>
                  </div>
                </NeedsBackendField>
              </CardContent>
            )}
          </Card>

          {/* Connection pool (collapsed, NEEDS BACKEND) */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('connectionPool')}>
              <CardTitle className="text-base">{t('create.sectionConnectionPool')}</CardTitle>
            </CardHeader>
            {expandedSections.connectionPool && (
              <CardContent>
                <NeedsBackendField>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.maxConnsPerHost')}</Label>
                      <Input type="number" disabled placeholder="100" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.maxIdleConns')}</Label>
                      <Input type="number" disabled placeholder="10" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('transport.keepAliveInterval')}</Label>
                      <Input disabled placeholder="30s" />
                    </div>
                  </div>
                </NeedsBackendField>
              </CardContent>
            )}
          </Card>

          {/* Labels (collapsed) */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => toggleSection('labels')}>
              <CardTitle className="text-base">{t('create.sectionLabels')}</CardTitle>
            </CardHeader>
            {expandedSections.labels && (
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Key-value labels for organizing and filtering services.
                </p>
                {/* TagInput / KeyValueEditor from Phase 1 goes here */}
                <div className="mt-2 rounded-md border p-4 text-center text-sm text-muted-foreground">
                  KeyValueEditor placeholder -- Phase 1 component required
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              YAML/JSON mode uses the YamlJsonEditor component from Phase 1.
            </p>
            <div className="mt-4 rounded-md border p-8 text-center text-sm text-muted-foreground">
              YamlJsonEditor placeholder -- Phase 1 component required
            </div>
          </CardContent>
        </Card>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-3 border-t pt-4">
        <Button
          onClick={handleCreate}
          disabled={saveMutation.isPending || !formValues.name || formValues.upstreams.every((u) => !u.address.trim())}
        >
          {saveMutation.isPending ? 'Creating...' : t('form.createService')}
        </Button>
        <Button variant="outline" render={<Link to="/config/services" />}>
          {tc('actions.cancel')}
        </Button>
      </div>
    </div>
  )
}
