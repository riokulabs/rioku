import { useState, useMemo } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  CheckIcon,
  XIcon,
  PlusIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Service as ServiceType } from '@/lib/api'
import { labelsToKvPairs, kvPairsToLabels } from '@/lib/form-yaml-sync'
import { KvEditor } from '@/components/rioku/kv-editor'
import {
  serviceFormSchema,
  serviceToFormValues,
  formValuesToServicePayload,
  LB_POLICY_LABELS,
  TLS_MODE_LABELS,
} from '@/lib/schemas/service'
import type { ServiceFormValues } from '@/lib/schemas/service'
import { useServiceMutations } from '@/hooks/use-config-mutations'
import { useDirtyForm } from '@/hooks/use-dirty-form'
import { useUnsavedWarning } from '@/hooks/use-unsaved-warning'
import { useTabFromUrl } from '@/hooks/use-tab-from-url'

import { PageHeader } from '@/components/rioku/page-header'
import { TimeAgo } from '@/components/rioku/time-ago'
import { StatusBadge } from '@/components/rioku/status-badge'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { DiffView } from '@/components/rioku/diff-view'
import type { DiffChange } from '@/components/rioku/diff-view'
import { NeedsBackendField } from '@/components/rioku/needs-backend-field'

import { YamlJsonEditor } from '@rioku/ui'
import { serviceFormToYaml, yamlToServiceForm } from '@/lib/form-yaml-sync'

import { SearchableSelect } from '@rioku/ui'
import type { SelectOption } from '@rioku/ui'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const SERVICE_TABS = ['overview', 'health-checks', 'transport', 'policies', 'traffic', 'activity'] as const

export const Route = createFileRoute('/config/services/$serviceId')({
  loader: async ({ context, params }) => {
    const config = await context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    })
    const service = config.services.find((s) => s.id === params.serviceId)
    if (!service) throw new Error('Service not found')
    return { service, policies: config.policies }
  },
  component: ServiceDetailPage,
})

function ServiceDetailPage() {
  const { t } = useTranslation('services')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()
  const router = useRouter()
  const { service, policies } = Route.useLoaderData()

  const { saveMutation, deleteMutation } = useServiceMutations()

  const [isEditing, setIsEditing] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  const [yamlMode, setYamlMode] = useState(false)
  const [yamlContent, setYamlContent] = useState('')
  const [yamlFormat, setYamlFormat] = useState<'yaml' | 'json'>('yaml')

  const initialValues = useMemo(() => serviceToFormValues(service), [service])
  const [formValues, setFormValues] = useState<ServiceFormValues>(initialValues)

  const { isDirty } = useDirtyForm(initialValues, formValues)
  useUnsavedWarning(isDirty)

  const { activeTab, setActiveTab } = useTabFromUrl('overview', SERVICE_TABS)

  function startEditing() {
    setFormValues(serviceToFormValues(service))
    setIsEditing(true)
  }

  function cancelEditing() {
    setFormValues(initialValues)
    setIsEditing(false)
    setYamlMode(false)
    setYamlContent('')
  }

  function openReview() {
    let valuesToValidate = formValues
    if (yamlMode) {
      const parsed = yamlToServiceForm(yamlContent)
      valuesToValidate = { ...formValues, ...parsed }
      setFormValues(valuesToValidate)
      setYamlMode(false)
    }
    const validation = serviceFormSchema.safeParse(valuesToValidate)
    if (!validation.success) {
      toast.error(validation.error.issues[0].message)
      return
    }
    setReviewOpen(true)
  }

  function handleSave() {
    const payload = formValuesToServicePayload(formValues, service.id)
    saveMutation.mutate(payload, {
      onSuccess: () => {
        toast.success(t('messages.serviceUpdated'))
        setIsEditing(false)
        setReviewOpen(false)
        router.invalidate()
      },
    })
  }

  function handleDelete() {
    deleteMutation.mutate(service.id, {
      onSuccess: () => {
        navigate({ to: '/config/services' })
      },
    })
  }

  function computeDiffChanges(): DiffChange[] {
    const changes: DiffChange[] = []
    if (initialValues.name !== formValues.name) {
      changes.push({ field: 'Name', oldValue: initialValues.name, newValue: formValues.name })
    }
    if (initialValues.lbPolicy !== formValues.lbPolicy) {
      changes.push({
        field: 'LB Policy',
        oldValue: LB_POLICY_LABELS[initialValues.lbPolicy],
        newValue: LB_POLICY_LABELS[formValues.lbPolicy],
      })
    }
    if (JSON.stringify(initialValues.upstreams) !== JSON.stringify(formValues.upstreams)) {
      changes.push({
        field: 'Upstreams',
        oldValue: initialValues.upstreams.map((u) => u.address).join(', '),
        newValue: formValues.upstreams.map((u) => u.address).join(', '),
      })
    }
    if (JSON.stringify(initialValues.activeHealthCheck) !== JSON.stringify(formValues.activeHealthCheck)) {
      changes.push({
        field: 'Health check',
        oldValue: initialValues.activeHealthCheck.enabled ? 'enabled' : 'disabled',
        newValue: formValues.activeHealthCheck.enabled ? 'enabled' : 'disabled',
      })
    }
    return changes
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" render={<Link to="/config/services" />}>
          <ArrowLeftIcon className="size-4" />
          <span className="sr-only">{t('detail.backToServices')}</span>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{service.name}</h1>
          <p className="text-sm text-muted-foreground">
            {t('detail.serviceId')}: <code className="font-mono text-xs">{service.id}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing ? (
            <Button variant="outline" onClick={startEditing}>
              <PencilIcon className="size-4" />
              {t('detail.editSection')}
            </Button>
          ) : (
            <>
              <Button
                variant={yamlMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (!yamlMode) {
                    setYamlContent(serviceFormToYaml(formValues))
                    setYamlMode(true)
                  } else {
                    const parsed = yamlToServiceForm(yamlContent)
                    setFormValues((prev) => ({ ...prev, ...parsed }))
                    setYamlMode(false)
                  }
                }}
              >
                {yamlMode ? t('detail.formMode', 'Form') : t('detail.yamlMode', 'YAML')}
              </Button>
              <Button variant="outline" onClick={() => { cancelEditing(); setYamlMode(false) }}>
                <XIcon className="size-4" />
                {t('detail.cancelEdit')}
              </Button>
              <Button onClick={openReview} disabled={!isDirty || saveMutation.isPending}>
                <CheckIcon className="size-4" />
                {t('detail.reviewChanges')}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <TrashIcon className="size-4 text-destructive" />
          </Button>
        </div>
      </div>

      {isEditing && yamlMode ? (
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              Edit the service configuration in YAML or JSON. Switch back to Form mode to use the structured editor.
            </p>
            <YamlJsonEditor
              value={yamlContent}
              onChange={setYamlContent}
              format={yamlFormat}
              onFormatChange={setYamlFormat}
              height="500px"
              showDownload
              downloadFilename={service.name}
            />
          </CardContent>
        </Card>
      ) : (
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="overview">{t('detail.overview')}</TabsTrigger>
          <TabsTrigger value="health-checks">{t('detail.healthChecks')}</TabsTrigger>
          <TabsTrigger value="transport">{t('detail.transport')}</TabsTrigger>
          <TabsTrigger value="policies">{t('detail.policiesTab')}</TabsTrigger>
          <TabsTrigger value="traffic">{t('detail.traffic')}</TabsTrigger>
          <TabsTrigger value="activity">{t('detail.activity')}</TabsTrigger>
        </TabsList>

        {/* --- Overview Tab --- */}
        <TabsContent value="overview">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t('detail.overview')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">{t('form.serviceName')}</Label>
                    {isEditing ? (
                      <Input
                        value={formValues.name}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, name: e.target.value }))
                        }
                      />
                    ) : (
                      <p className="font-mono text-sm">{service.name}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t('form.lbPolicy')}</Label>
                    {isEditing ? (
                      <SearchableSelect
                        options={Object.entries(LB_POLICY_LABELS).map(([value, label]): SelectOption => ({
                          value,
                          label,
                        }))}
                        value={formValues.lbPolicy}
                        onChange={(val) =>
                          setFormValues((prev) => ({ ...prev, lbPolicy: val as ServiceFormValues['lbPolicy'] }))
                        }
                        placeholder="Search policies..."
                      />
                    ) : (
                      <Badge variant="outline">
                        {LB_POLICY_LABELS[service.lbPolicy] ?? service.lbPolicy}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Upstreams */}
                <div>
                  <Label className="text-xs text-muted-foreground">{t('table.upstreams')}</Label>
                  {isEditing ? (
                    <div className="mt-2 space-y-2">
                      {formValues.upstreams.map((upstream, idx) => (
                        <div key={idx} className="flex items-center gap-2 rounded-md border p-2">
                          <Input
                            value={upstream.address}
                            onChange={(e) => {
                              const next = [...formValues.upstreams]
                              next[idx] = { ...next[idx], address: e.target.value }
                              setFormValues((prev) => ({ ...prev, upstreams: next }))
                            }}
                            placeholder={t('form.addressPlaceholder')}
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            min={0}
                            value={upstream.weight}
                            onChange={(e) => {
                              const next = [...formValues.upstreams]
                              next[idx] = { ...next[idx], weight: parseInt(e.target.value, 10) || 0 }
                              setFormValues((prev) => ({ ...prev, upstreams: next }))
                            }}
                            className="w-20"
                          />
                          <Select
                            value={upstream.tls}
                            onValueChange={(val) => {
                              const next = [...formValues.upstreams]
                              next[idx] = { ...next[idx], tls: val as typeof upstream.tls }
                              setFormValues((prev) => ({ ...prev, upstreams: next }))
                            }}
                          >
                            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(TLS_MODE_LABELS).map(([v, l]) => (
                                <SelectItem key={v} value={v}>{l}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {formValues.upstreams.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => {
                                const next = formValues.upstreams.filter((_, i) => i !== idx)
                                setFormValues((prev) => ({ ...prev, upstreams: next }))
                              }}
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
                    </div>
                  ) : (
                    <div className="mt-2 space-y-1">
                      {service.upstreams.map((u, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <StatusBadge status={u.healthy ? 'healthy' : 'unhealthy'} />
                          <code className="font-mono text-xs">{u.address}</code>
                          <span className="text-xs text-muted-foreground">w:{u.weight}</span>
                          <Badge variant="outline" className="text-xs">
                            {TLS_MODE_LABELS[u.tls] ?? u.tls}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Metadata sidebar */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground">{t('detail.createdAt')}</span>
                  <p>{service.createdAt ? <TimeAgo date={service.createdAt} /> : '\u2014'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('detail.updatedAt')}</span>
                  <p>{service.updatedAt ? <TimeAgo date={service.updatedAt} /> : '\u2014'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('detail.serviceId')}</span>
                  <p className="font-mono text-xs break-all">{service.id}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('detail.upstreamCount')}</span>
                  <p>{service.upstreams.length}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Labels */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-sm">Labels</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <KvEditor
                  value={labelsToKvPairs(formValues.labels)}
                  onChange={(pairs) =>
                    setFormValues((prev) => ({ ...prev, labels: kvPairsToLabels(pairs) }))
                  }
                  keyPlaceholder="Label key"
                  valuePlaceholder="Label value"
                />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(service.labels ?? {}).map(([k, v]) => (
                    <Badge key={k} variant="outline">
                      <span className="font-mono text-xs">{k}</span>
                      <span className="mx-1 text-muted-foreground">=</span>
                      <span className="font-mono text-xs">{v}</span>
                    </Badge>
                  ))}
                  {Object.keys(service.labels ?? {}).length === 0 && (
                    <span className="text-sm text-muted-foreground">No labels</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Health Checks Tab --- */}
        <TabsContent value="health-checks">
          <Card>
            <CardHeader>
              <CardTitle>{t('healthChecks.active')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">{t('healthChecks.activeDescription')}</p>
              {isEditing ? (
                <div className="space-y-3">
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
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      status={service.healthCheck?.enabled ? 'healthy' : 'unknown'}
                      label={service.healthCheck?.enabled ? 'Active' : 'Disabled'}
                    />
                  </div>
                  {service.healthCheck?.enabled && (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-muted-foreground">Path:</span> {service.healthCheck.path}</div>
                      <div><span className="text-muted-foreground">Interval:</span> {service.healthCheck.intervalSeconds}s</div>
                      <div><span className="text-muted-foreground">Timeout:</span> {service.healthCheck.timeoutSeconds}s</div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Passive health checks -- NEEDS BACKEND */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('healthChecks.passive')}</CardTitle>
            </CardHeader>
            <CardContent>
              <NeedsBackendField>
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">{t('healthChecks.passiveDescription')}</p>
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
                </div>
              </NeedsBackendField>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Transport Tab (NEEDS BACKEND) --- */}
        <TabsContent value="transport">
          <NeedsBackendField message="Transport configuration requires proto enrichment">
            <Card>
              <CardHeader>
                <CardTitle>{t('transport.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4">{t('transport.description')}</p>
                <div className="grid grid-cols-2 gap-4">
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
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transport.maxRetries')}</Label>
                    <Input type="number" disabled placeholder="3" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transport.retryStatuses')}</Label>
                    <Input disabled placeholder="502, 503, 504" />
                  </div>
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
              </CardContent>
            </Card>
          </NeedsBackendField>
        </TabsContent>

        {/* --- Policies Tab (placeholder) --- */}
        <TabsContent value="policies">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.policiesTab')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Service-level policy attachment is configured on individual routes that target this service.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Traffic Tab (NEEDS BACKEND) --- */}
        <TabsContent value="traffic">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.traffic')}</CardTitle>
            </CardHeader>
            <CardContent>
              <NeedsBackendField message="Per-service traffic analytics require TrafficService enrichment">
                <p className="text-sm text-muted-foreground">
                  Request volume, latency percentiles, and error rates for this service will appear here once TrafficService per-service filtering is implemented.
                </p>
              </NeedsBackendField>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Activity Tab (NEEDS BACKEND) --- */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.activity')}</CardTitle>
            </CardHeader>
            <CardContent>
              <NeedsBackendField message="Per-entity activity logs require audit trail enrichment">
                <p className="text-sm text-muted-foreground">
                  Configuration changes and audit events for this service will appear here once per-entity audit filtering is implemented.
                </p>
              </NeedsBackendField>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      )}

      {/* Review changes dialog */}
      <ConfirmDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={t('detail.reviewChanges')}
        description=""
        confirmLabel={t('detail.applyChanges')}
        variant="default"
        loading={saveMutation.isPending}
        onConfirm={handleSave}
      >
        <DiffView changes={computeDiffChanges()} />
      </ConfirmDialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t('messages.confirmDeleteTitle')}
        description={t('messages.confirmDelete')}
        confirmLabel={tc('actions.delete')}
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
