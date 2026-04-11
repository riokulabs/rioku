import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeftIcon, PlusIcon, XIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Service, Policy } from '@/lib/api'
import { labelsToKvPairs, kvPairsToLabels } from '@/lib/form-yaml-sync'
import { KvEditor } from '@/components/rioku/kv-editor'
import {
  routeFormSchema,
  formValuesToRoutePayload,
  HTTP_METHODS,
} from '@/lib/schemas/route'
import type { RouteFormValues } from '@/lib/schemas/route'
import { useRouteMutations } from '@/hooks/use-config-mutations'
import { useDirtyForm } from '@/hooks/use-dirty-form'
import { useUnsavedWarning } from '@/hooks/use-unsaved-warning'

import { PageHeader } from '@/components/rioku/page-header'
import { NeedsBackendField } from '@/components/rioku/needs-backend-field'
import { WizardStepIndicator } from '@/components/rioku/wizard-step-indicator'

import { SearchableSelect, SearchableMultiSelect } from '@rioku/ui'
import type { SelectOption } from '@rioku/ui'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { YamlJsonEditor } from '@rioku/ui'
import { routeFormToYaml, yamlToRouteForm } from '@/lib/form-yaml-sync'

export const Route = createFileRoute('/config/routes/create')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    }),
  component: RouteCreatePage,
})

const EMPTY_FORM: RouteFormValues = {
  name: '',
  enabled: true,
  hosts: [],
  paths: [{ type: 'TYPE_PREFIX', value: '' }],
  methods: [],
  headers: [],
  targetType: 'service',
  serviceId: '',
  directAddress: '',
  directTls: 'TLS_MODE_OFF',
  policyIds: [],
  labels: {},
  forceTls: false,
  minTlsVersion: '1.2',
  clientAuth: 'off',
}

const WIZARD_STEPS = ['Basics', 'Matching', 'Target', 'Policies & TLS', 'Review']

function RouteCreatePage() {
  const { t } = useTranslation('routes')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()
  const config = Route.useLoaderData()
  const services = config.services
  const policies = config.policies

  const { saveMutation } = useRouteMutations()

  const [mode, setMode] = useState<'form' | 'wizard' | 'code'>('form')
  const [wizardStep, setWizardStep] = useState(0)
  const [formValues, setFormValues] = useState<RouteFormValues>(EMPTY_FORM)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basics: true,
    matching: true,
    target: true,
    policies: false,
    labels: false,
    tls: false,
    advanced: false,
  })

  const [yamlContent, setYamlContent] = useState('')
  const [yamlFormat, setYamlFormat] = useState<'yaml' | 'json'>('yaml')

  const { isDirty } = useDirtyForm(EMPTY_FORM, formValues)
  useUnsavedWarning(isDirty)

  function toggleSection(key: string) {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function handleCreate() {
    const validation = routeFormSchema.safeParse(formValues)
    if (!validation.success) {
      toast.error(validation.error.issues[0].message)
      return
    }
    const payload = formValuesToRoutePayload(formValues)
    saveMutation.mutate(payload, {
      onSuccess: () => {
        toast.success(t('messages.routeCreated'))
        navigate({ to: '/config/routes' })
      },
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" render={<Link to="/config/routes" />}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <PageHeader
          title={t('create.title')}
          description={t('create.subtitle')}
        />
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        {(['form', 'wizard', 'code'] as const).map((m) => (
          <Button
            key={m}
            variant={mode === m ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              if (mode === 'code' && m !== 'code') {
                const parsed = yamlToRouteForm(yamlContent)
                setFormValues((prev) => ({ ...prev, ...parsed }))
              }
              if (mode !== 'code' && m === 'code') {
                setYamlContent(routeFormToYaml(formValues))
              }
              setMode(m)
              if (m === 'wizard') setWizardStep(0)
            }}
          >
            {m === 'code' ? t('create.codeMode') : m === 'wizard' ? 'Wizard' : t('create.formMode')}
          </Button>
        ))}
      </div>

      {mode === 'form' && (
        <div className="space-y-4">
          {/* Basics section */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('basics')}
            >
              <CardTitle className="text-base">{t('create.sectionBasics')}</CardTitle>
            </CardHeader>
            {expandedSections.basics && (
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="route-name">
                    {t('form.routeName')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="route-name"
                    value={formValues.name}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder={t('form.routeNamePlaceholder')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="route-enabled">{t('form.enabled')}</Label>
                    <p className="text-xs text-muted-foreground">{t('form.enabledDescription')}</p>
                  </div>
                  <Switch
                    id="route-enabled"
                    checked={formValues.enabled}
                    onCheckedChange={(checked) =>
                      setFormValues((prev) => ({ ...prev, enabled: checked }))
                    }
                  />
                </div>
              </CardContent>
            )}
          </Card>

          {/* Matching section */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('matching')}
            >
              <CardTitle className="text-base">{t('create.sectionMatching')}</CardTitle>
            </CardHeader>
            {expandedSections.matching && (
              <CardContent className="space-y-4">
                {/* Hosts */}
                <div className="space-y-2">
                  <Label>{t('matching.hosts')}</Label>
                  <Input
                    value={formValues.hosts.join(', ')}
                    onChange={(e) =>
                      setFormValues((prev) => ({
                        ...prev,
                        hosts: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      }))
                    }
                    placeholder="api.example.com, *.example.com"
                  />
                  <p className="text-xs text-muted-foreground">{t('matching.hostsDescription')}</p>
                </div>
                {/* Paths */}
                <div className="space-y-2">
                  <Label>{t('matching.paths')}</Label>
                  {formValues.paths.map((path, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Select
                        value={path.type}
                        onValueChange={(val) => {
                          const next = [...formValues.paths]
                          next[idx] = { ...next[idx], type: val as typeof path.type }
                          setFormValues((prev) => ({ ...prev, paths: next }))
                        }}
                      >
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TYPE_PREFIX">Prefix</SelectItem>
                          <SelectItem value="TYPE_EXACT">Exact</SelectItem>
                          <SelectItem value="TYPE_REGEXP">Regexp</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={path.value}
                        onChange={(e) => {
                          const next = [...formValues.paths]
                          next[idx] = { ...next[idx], value: e.target.value }
                          setFormValues((prev) => ({ ...prev, paths: next }))
                        }}
                        placeholder={t('matching.pathValuePlaceholder')}
                        className="flex-1"
                      />
                      {formValues.paths.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => {
                            const next = formValues.paths.filter((_, i) => i !== idx)
                            setFormValues((prev) => ({ ...prev, paths: next }))
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
                        paths: [...prev.paths, { type: 'TYPE_PREFIX', value: '' }],
                      }))
                    }
                  >
                    {t('matching.addPath')}
                  </Button>
                </div>
                {/* Methods */}
                <div className="space-y-2">
                  <Label>{t('matching.methods')}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {HTTP_METHODS.map((method) => (
                      <Button
                        key={method}
                        variant={formValues.methods.includes(method) ? 'default' : 'outline'}
                        size="xs"
                        onClick={() =>
                          setFormValues((prev) => ({
                            ...prev,
                            methods: prev.methods.includes(method)
                              ? prev.methods.filter((m) => m !== method)
                              : [...prev.methods, method] as RouteFormValues['methods'],
                          }))
                        }
                      >
                        {method}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('matching.methodsDescription')}</p>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Target section */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('target')}
            >
              <CardTitle className="text-base">{t('create.sectionTarget')}</CardTitle>
            </CardHeader>
            {expandedSections.target && (
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button
                    variant={formValues.targetType === 'service' ? 'default' : 'outline'}
                    onClick={() => setFormValues((prev) => ({ ...prev, targetType: 'service' }))}
                  >
                    {t('form.targetTypeService')}
                  </Button>
                  <Button
                    variant={formValues.targetType === 'direct' ? 'default' : 'outline'}
                    onClick={() => setFormValues((prev) => ({ ...prev, targetType: 'direct' }))}
                  >
                    {t('form.targetTypeDirect')}
                  </Button>
                </div>
                {formValues.targetType === 'service' ? (
                  <div className="space-y-2">
                    <Label>
                      {t('form.targetService')} <span className="text-destructive">*</span>
                    </Label>
                    <SearchableSelect
                      options={services.map((svc: Service): SelectOption => ({
                        value: svc.id,
                        label: svc.name,
                        description: `${svc.upstreams.length} upstream${svc.upstreams.length !== 1 ? 's' : ''} - ${svc.lbPolicy.replace('LB_POLICY_', '').toLowerCase().replace(/_/g, ' ')}`,
                        badge: `${svc.upstreams.length}`,
                      }))}
                      value={formValues.serviceId}
                      onChange={(val) =>
                        setFormValues((prev) => ({ ...prev, serviceId: val }))
                      }
                      placeholder={t('form.selectService', 'Search services...')}
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>
                        {t('form.directAddress')} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        value={formValues.directAddress}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, directAddress: e.target.value }))
                        }
                        placeholder={t('form.directAddressPlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('form.directTls')}</Label>
                      <Select
                        value={formValues.directTls}
                        onValueChange={(val) =>
                          setFormValues((prev) => ({ ...prev, directTls: val as RouteFormValues['directTls'] }))
                        }
                      >
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TLS_MODE_OFF">Off</SelectItem>
                          <SelectItem value="TLS_MODE_AUTO">Auto</SelectItem>
                          <SelectItem value="TLS_MODE_CUSTOM">Custom</SelectItem>
                          <SelectItem value="TLS_MODE_INTERNAL">Internal (mTLS)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* Policies section (collapsed) */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('policies')}
            >
              <CardTitle className="text-base">{t('create.sectionPolicies')}</CardTitle>
            </CardHeader>
            {expandedSections.policies && (
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">
                  {t('policies.attachedDescription')}
                </p>
                <SearchableMultiSelect
                  options={policies.map((p: Policy): SelectOption => ({
                    value: p.id,
                    label: p.name,
                    description: p.type.replace('POLICY_TYPE_', '').toLowerCase().replace(/_/g, ' '),
                    badge: p.type.replace('POLICY_TYPE_', '').replace(/_/g, ' '),
                  }))}
                  value={formValues.policyIds}
                  onChange={(ids) =>
                    setFormValues((prev) => ({ ...prev, policyIds: ids }))
                  }
                  placeholder={t('policies.searchPolicies', 'Search policies...')}
                />
              </CardContent>
            )}
          </Card>

          {/* Labels section */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('labels')}
            >
              <CardTitle className="text-base">{t('create.sectionLabels', 'Labels')}</CardTitle>
            </CardHeader>
            {expandedSections.labels && (
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  {t('labels.description', 'Key-value labels for organizing and filtering routes.')}
                </p>
                <KvEditor
                  value={labelsToKvPairs(formValues.labels)}
                  onChange={(pairs) =>
                    setFormValues((prev) => ({ ...prev, labels: kvPairsToLabels(pairs) }))
                  }
                  keyPlaceholder="Label key"
                  valuePlaceholder="Label value"
                />
              </CardContent>
            )}
          </Card>

          {/* TLS section (collapsed, NEEDS BACKEND) */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('tls')}
            >
              <CardTitle className="text-base">{t('create.sectionTls')}</CardTitle>
            </CardHeader>
            {expandedSections.tls && (
              <CardContent>
                <NeedsBackendField>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label>{t('tls.forceHttps')}</Label>
                      <Switch checked={false} disabled />
                    </div>
                    <div>
                      <Label>{t('tls.minVersion')}</Label>
                      <Select disabled value="1.2">
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1.2">TLS 1.2</SelectItem>
                          <SelectItem value="1.3">TLS 1.3</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{t('tls.clientAuth')}</Label>
                      <Select disabled value="off">
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="off">{t('tls.clientAuthOff')}</SelectItem>
                          <SelectItem value="request">{t('tls.clientAuthRequest')}</SelectItem>
                          <SelectItem value="require">{t('tls.clientAuthRequire')}</SelectItem>
                          <SelectItem value="require_and_verify">{t('tls.clientAuthRequireVerify')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </NeedsBackendField>
              </CardContent>
            )}
          </Card>

          {/* Advanced section (collapsed, NEEDS BACKEND) */}
          <Card>
            <CardHeader
              className="cursor-pointer"
              onClick={() => toggleSection('advanced')}
            >
              <CardTitle className="text-base">{t('create.sectionAdvanced')}</CardTitle>
            </CardHeader>
            {expandedSections.advanced && (
              <CardContent>
                <NeedsBackendField>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>{t('create.advancedQueryMatchers')}</Label>
                      <Input disabled placeholder="key=value" />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('create.advancedCelExpression')}</Label>
                      <Input disabled placeholder="request.host.endsWith('.example.com')" />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>{t('create.advancedStreaming')}</Label>
                      <Switch checked={false} disabled />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('create.advancedPriority')}</Label>
                      <Input type="number" disabled placeholder="0" className="w-24" />
                    </div>
                  </div>
                </NeedsBackendField>
              </CardContent>
            )}
          </Card>
        </div>
      )}

      {/* Wizard mode */}
      {mode === 'wizard' && (
        <div className="space-y-6">
          <WizardStepIndicator steps={WIZARD_STEPS} currentStep={wizardStep} />

          {/* Step 0: Basics */}
          {wizardStep === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Basics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Set the route name and toggle its status.</p>
                <div className="space-y-2">
                  <Label htmlFor="wiz-name">
                    {t('form.routeName')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="wiz-name"
                    value={formValues.name}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder={t('form.routeNamePlaceholder')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="wiz-enabled">{t('form.enabled')}</Label>
                    <p className="text-xs text-muted-foreground">{t('form.enabledDescription')}</p>
                  </div>
                  <Switch
                    id="wiz-enabled"
                    checked={formValues.enabled}
                    onCheckedChange={(checked) =>
                      setFormValues((prev) => ({ ...prev, enabled: checked }))
                    }
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 1: Matching */}
          {wizardStep === 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Matching Rules</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Define how incoming requests are matched to this route.</p>
                {/* Hosts */}
                <div className="space-y-2">
                  <Label>{t('matching.hosts')}</Label>
                  <Input
                    value={formValues.hosts.join(', ')}
                    onChange={(e) =>
                      setFormValues((prev) => ({
                        ...prev,
                        hosts: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      }))
                    }
                    placeholder="api.example.com, *.example.com"
                  />
                  <p className="text-xs text-muted-foreground">{t('matching.hostsDescription')}</p>
                </div>
                {/* Paths */}
                <div className="space-y-2">
                  <Label>{t('matching.paths')}</Label>
                  {formValues.paths.map((path, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Select
                        value={path.type}
                        onValueChange={(val) => {
                          const next = [...formValues.paths]
                          next[idx] = { ...next[idx], type: val as typeof path.type }
                          setFormValues((prev) => ({ ...prev, paths: next }))
                        }}
                      >
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TYPE_PREFIX">Prefix</SelectItem>
                          <SelectItem value="TYPE_EXACT">Exact</SelectItem>
                          <SelectItem value="TYPE_REGEXP">Regexp</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={path.value}
                        onChange={(e) => {
                          const next = [...formValues.paths]
                          next[idx] = { ...next[idx], value: e.target.value }
                          setFormValues((prev) => ({ ...prev, paths: next }))
                        }}
                        placeholder={t('matching.pathValuePlaceholder')}
                        className="flex-1"
                      />
                      {formValues.paths.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => {
                            const next = formValues.paths.filter((_, i) => i !== idx)
                            setFormValues((prev) => ({ ...prev, paths: next }))
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
                        paths: [...prev.paths, { type: 'TYPE_PREFIX', value: '' }],
                      }))
                    }
                  >
                    {t('matching.addPath')}
                  </Button>
                </div>
                {/* Methods */}
                <div className="space-y-2">
                  <Label>{t('matching.methods')}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {HTTP_METHODS.map((method) => (
                      <Button
                        key={method}
                        variant={formValues.methods.includes(method) ? 'default' : 'outline'}
                        size="xs"
                        onClick={() =>
                          setFormValues((prev) => ({
                            ...prev,
                            methods: prev.methods.includes(method)
                              ? prev.methods.filter((m) => m !== method)
                              : [...prev.methods, method] as RouteFormValues['methods'],
                          }))
                        }
                      >
                        {method}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('matching.methodsDescription')}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 2: Target */}
          {wizardStep === 2 && (
            <Card>
              <CardHeader>
                <CardTitle>Target</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Choose where matched requests should be routed.</p>
                <div className="flex gap-2">
                  <Button
                    variant={formValues.targetType === 'service' ? 'default' : 'outline'}
                    onClick={() => setFormValues((prev) => ({ ...prev, targetType: 'service' }))}
                  >
                    {t('form.targetTypeService')}
                  </Button>
                  <Button
                    variant={formValues.targetType === 'direct' ? 'default' : 'outline'}
                    onClick={() => setFormValues((prev) => ({ ...prev, targetType: 'direct' }))}
                  >
                    {t('form.targetTypeDirect')}
                  </Button>
                </div>
                {formValues.targetType === 'service' ? (
                  <div className="space-y-2">
                    <Label>
                      {t('form.targetService')} <span className="text-destructive">*</span>
                    </Label>
                    <SearchableSelect
                      options={services.map((svc: Service): SelectOption => ({
                        value: svc.id,
                        label: svc.name,
                        description: `${svc.upstreams.length} upstream${svc.upstreams.length !== 1 ? 's' : ''} - ${svc.lbPolicy.replace('LB_POLICY_', '').toLowerCase().replace(/_/g, ' ')}`,
                        badge: `${svc.upstreams.length}`,
                      }))}
                      value={formValues.serviceId}
                      onChange={(val) =>
                        setFormValues((prev) => ({ ...prev, serviceId: val }))
                      }
                      placeholder={t('form.selectService', 'Search services...')}
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>
                        {t('form.directAddress')} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        value={formValues.directAddress}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, directAddress: e.target.value }))
                        }
                        placeholder={t('form.directAddressPlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('form.directTls')}</Label>
                      <Select
                        value={formValues.directTls}
                        onValueChange={(val) =>
                          setFormValues((prev) => ({ ...prev, directTls: val as RouteFormValues['directTls'] }))
                        }
                      >
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TLS_MODE_OFF">Off</SelectItem>
                          <SelectItem value="TLS_MODE_AUTO">Auto</SelectItem>
                          <SelectItem value="TLS_MODE_CUSTOM">Custom</SelectItem>
                          <SelectItem value="TLS_MODE_INTERNAL">Internal (mTLS)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step 3: Policies & TLS */}
          {wizardStep === 3 && (
            <Card>
              <CardHeader>
                <CardTitle>Policies & TLS</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Attach policies and configure TLS settings.</p>
                <div className="space-y-2">
                  <Label>{t('create.sectionPolicies')}</Label>
                  <SearchableMultiSelect
                    options={policies.map((p: Policy): SelectOption => ({
                      value: p.id,
                      label: p.name,
                      description: p.type.replace('POLICY_TYPE_', '').toLowerCase().replace(/_/g, ' '),
                      badge: p.type.replace('POLICY_TYPE_', '').replace(/_/g, ' '),
                    }))}
                    value={formValues.policyIds}
                    onChange={(ids) =>
                      setFormValues((prev) => ({ ...prev, policyIds: ids }))
                    }
                    placeholder={t('policies.searchPolicies', 'Search policies...')}
                  />
                </div>
                <NeedsBackendField>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label>{t('tls.forceHttps')}</Label>
                      <Switch checked={false} disabled />
                    </div>
                    <div>
                      <Label>{t('tls.minVersion')}</Label>
                      <Select disabled value="1.2">
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1.2">TLS 1.2</SelectItem>
                          <SelectItem value="1.3">TLS 1.3</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{t('tls.clientAuth')}</Label>
                      <Select disabled value="off">
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="off">{t('tls.clientAuthOff')}</SelectItem>
                          <SelectItem value="request">{t('tls.clientAuthRequest')}</SelectItem>
                          <SelectItem value="require">{t('tls.clientAuthRequire')}</SelectItem>
                          <SelectItem value="require_and_verify">{t('tls.clientAuthRequireVerify')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </NeedsBackendField>
              </CardContent>
            </Card>
          )}

          {/* Step 4: Review */}
          {wizardStep === 4 && (
            <Card>
              <CardHeader>
                <CardTitle>Review Route Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-muted-foreground">Verify the settings below before creating this route.</p>
                <div className="divide-y divide-border/50">
                  {[
                    { label: 'Name', value: formValues.name || '(not set)' },
                    { label: 'Enabled', value: formValues.enabled ? 'Yes' : 'No' },
                    { label: 'Hosts', value: formValues.hosts.join(', ') || '(none)' },
                    { label: 'Paths', value: formValues.paths.map((p) => `${p.type}: ${p.value}`).join(', ') || '(none)' },
                    { label: 'Methods', value: formValues.methods.join(', ') || '(all)' },
                    {
                      label: 'Target',
                      value: formValues.targetType === 'service'
                        ? `Service: ${services.find((s: Service) => s.id === formValues.serviceId)?.name ?? formValues.serviceId}`
                        : `Direct: ${formValues.directAddress}`,
                    },
                    {
                      label: 'Policies',
                      value: formValues.policyIds.map((id) => policies.find((p: Policy) => p.id === id)?.name ?? id).join(', ') || '(none)',
                    },
                    { label: 'Force TLS', value: formValues.forceTls ? 'Yes' : 'No' },
                    { label: 'Min TLS Version', value: formValues.minTlsVersion },
                  ].map((item) => (
                    <div key={item.label} className="grid grid-cols-[180px_1fr] gap-4 py-3">
                      <span className="text-sm text-muted-foreground">{item.label}</span>
                      <span className="text-sm">{item.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Wizard navigation */}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => setWizardStep((s) => Math.max(0, s - 1))}
              disabled={wizardStep === 0}
            >
              Back
            </Button>
            {wizardStep === WIZARD_STEPS.length - 1 ? (
              <Button
                onClick={handleCreate}
                disabled={saveMutation.isPending || !formValues.name}
              >
                {saveMutation.isPending ? 'Creating...' : t('form.createRoute')}
              </Button>
            ) : (
              <Button onClick={() => setWizardStep((s) => Math.min(WIZARD_STEPS.length - 1, s + 1))}>
                Continue
              </Button>
            )}
          </div>
        </div>
      )}

      {/* YAML/JSON mode */}
      {mode === 'code' && (
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              {t('create.codeDescription', 'Edit route configuration in YAML or JSON format. Changes sync back to the form when you switch modes.')}
            </p>
            <YamlJsonEditor
              value={yamlContent}
              onChange={setYamlContent}
              format={yamlFormat}
              onFormatChange={setYamlFormat}
              height="400px"
              showDownload
              downloadFilename="route"
            />
          </CardContent>
        </Card>
      )}

      {/* Footer actions (form + code modes only; wizard has its own nav) */}
      {mode !== 'wizard' && (
        <div className="flex items-center gap-3 border-t pt-4">
          <Button
            onClick={handleCreate}
            disabled={saveMutation.isPending || !formValues.name}
          >
            {saveMutation.isPending ? 'Creating...' : t('form.createRoute')}
          </Button>
          <Button variant="outline" render={<Link to="/config/routes" />}>
            {tc('actions.cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}
