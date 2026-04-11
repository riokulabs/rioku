import { useState, useMemo, useEffect } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon,
  XIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Route as RouteType, Service, Policy } from '@/lib/api'
import { labelsToKvPairs, kvPairsToLabels } from '@/lib/form-yaml-sync'
import { routeFormSchema, routeToFormValues, formValuesToRoutePayload } from '@/lib/schemas/route'
import type { RouteFormValues } from '@/lib/schemas/route'
import { useRouteMutations } from '@/hooks/use-config-mutations'
import { useDirtyForm } from '@/hooks/use-dirty-form'
import { useUnsavedWarning } from '@/hooks/use-unsaved-warning'
import { useRecentlyViewed } from '@/hooks/use-recently-viewed'
import { useTabFromUrl } from '@/hooks/use-tab-from-url'

import { PageHeader } from '@/components/rioku/page-header'
import { TimeAgo } from '@/components/rioku/time-ago'
import { StatusBadge } from '@/components/rioku/status-badge'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { DiffView } from '@/components/rioku/diff-view'
import type { DiffChange } from '@/components/rioku/diff-view'
import { NeedsBackendField } from '@/components/rioku/needs-backend-field'
import { EmptyState } from '@/components/rioku/empty-state'
import { TrafficTab } from '@/components/rioku/traffic-tab'
import { ActivityTimeline } from '@/components/rioku/activity-timeline'

import { routeFormToYaml, yamlToRouteForm } from '@/lib/form-yaml-sync'
import { KvEditor } from '@/components/rioku/kv-editor'

import { SearchableSelect, SearchableMultiSelect, YamlJsonEditor } from '@rioku/ui'
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

const ROUTE_TABS = ['overview', 'matching', 'tls', 'policies', 'traffic', 'activity'] as const

export const Route = createFileRoute('/config/routes/$routeId')({
  loader: async ({ context, params }) => {
    const config = await context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    })
    const route = config.routes.find((r) => r.id === params.routeId)
    if (!route) throw new Error('Route not found')
    return { route, services: config.services, policies: config.policies }
  },
  component: RouteDetailPage,
})

function RouteDetailPage() {
  const { t } = useTranslation('routes')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()
  const router = useRouter()
  const { route, services, policies } = Route.useLoaderData()

  const { saveMutation, deleteMutation, toggleMutation } = useRouteMutations()
  const { addRecent } = useRecentlyViewed()

  // Track recently viewed
  useEffect(() => {
    if (route) {
      addRecent({
        type: 'route',
        id: route.id,
        name: route.name,
        path: `/config/routes/${route.id}`,
      })
    }
  }, [route?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const [isEditing, setIsEditing] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  const [yamlMode, setYamlMode] = useState(false)
  const [yamlContent, setYamlContent] = useState('')
  const [yamlFormat, setYamlFormat] = useState<'yaml' | 'json'>('yaml')

  const initialValues = useMemo(() => routeToFormValues(route), [route])
  const [formValues, setFormValues] = useState<RouteFormValues>(initialValues)

  const { isDirty } = useDirtyForm(initialValues, formValues)
  useUnsavedWarning(isDirty)

  const { activeTab, setActiveTab } = useTabFromUrl('overview', ROUTE_TABS)

  function startEditing() {
    setFormValues(routeToFormValues(route))
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
      const parsed = yamlToRouteForm(yamlContent)
      valuesToValidate = { ...formValues, ...parsed }
      setFormValues(valuesToValidate)
      setYamlMode(false)
    }
    const validation = routeFormSchema.safeParse(valuesToValidate)
    if (!validation.success) {
      toast.error(validation.error.issues[0].message)
      return
    }
    setReviewOpen(true)
  }

  function handleSave() {
    const payload = formValuesToRoutePayload(formValues, route.id)
    saveMutation.mutate(payload, {
      onSuccess: () => {
        toast.success(t('messages.routeUpdated'))
        setIsEditing(false)
        setReviewOpen(false)
        router.invalidate()
      },
    })
  }

  function handleDelete() {
    deleteMutation.mutate(route.id, {
      onSuccess: () => {
        navigate({ to: '/config/routes' })
      },
    })
  }

  function computeDiffChanges(): DiffChange[] {
    const changes: DiffChange[] = []
    if (initialValues.name !== formValues.name) {
      changes.push({ field: 'Name', oldValue: initialValues.name, newValue: formValues.name })
    }
    if (initialValues.enabled !== formValues.enabled) {
      changes.push({
        field: 'Enabled',
        oldValue: String(initialValues.enabled),
        newValue: String(formValues.enabled),
      })
    }
    if (JSON.stringify(initialValues.hosts) !== JSON.stringify(formValues.hosts)) {
      changes.push({
        field: 'Hosts',
        oldValue: initialValues.hosts.join(', ') || null,
        newValue: formValues.hosts.join(', ') || null,
      })
    }
    if (JSON.stringify(initialValues.paths) !== JSON.stringify(formValues.paths)) {
      changes.push({
        field: 'Paths',
        oldValue: initialValues.paths.map((p) => p.value).join(', ') || null,
        newValue: formValues.paths.map((p) => p.value).join(', ') || null,
      })
    }
    if (JSON.stringify(initialValues.methods) !== JSON.stringify(formValues.methods)) {
      changes.push({
        field: 'Methods',
        oldValue: initialValues.methods.join(', ') || null,
        newValue: formValues.methods.join(', ') || null,
      })
    }
    if (initialValues.serviceId !== formValues.serviceId) {
      changes.push({
        field: 'Target service',
        oldValue: initialValues.serviceId || null,
        newValue: formValues.serviceId || null,
      })
    }
    if (JSON.stringify(initialValues.policyIds) !== JSON.stringify(formValues.policyIds)) {
      changes.push({
        field: 'Policies',
        oldValue: initialValues.policyIds.join(', ') || null,
        newValue: formValues.policyIds.join(', ') || null,
      })
    }
    return changes
  }

  function getServiceName(serviceId: string): string {
    return services.find((s: Service) => s.id === serviceId)?.name ?? serviceId
  }

  function getPolicyName(policyId: string): string {
    return policies.find((p: Policy) => p.id === policyId)?.name ?? policyId
  }

  const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" render={<Link to="/config/routes" />}>
          <ArrowLeftIcon className="size-4" />
          <span className="sr-only">{t('detail.backToRoutes')}</span>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{route.name}</h1>
            <Switch
              checked={route.enabled}
              onCheckedChange={() =>
                toggleMutation.mutate({ id: route.id, enabled: route.enabled })
              }
              size="sm"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('detail.routeId')}: <code className="font-mono text-xs">{route.id}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <Button variant="outline" onClick={startEditing}>
              <PencilIcon className="size-4" />
              {t('detail.editSection')}
            </Button>
          )}
          {isEditing && (
            <>
              <Button
                variant={yamlMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (!yamlMode) {
                    // form -> YAML
                    setYamlContent(routeFormToYaml(formValues))
                    setYamlMode(true)
                  } else {
                    // YAML -> form
                    const parsed = yamlToRouteForm(yamlContent)
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

      {/* YAML mode replaces the tabs entirely */}
      {isEditing && yamlMode ? (
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              Edit the route configuration in YAML or JSON. Switch back to Form mode to use the structured editor.
            </p>
            <YamlJsonEditor
              value={yamlContent}
              onChange={setYamlContent}
              format={yamlFormat}
              onFormatChange={setYamlFormat}
              height="500px"
              showDownload
              downloadFilename={route.name}
            />
          </CardContent>
        </Card>
      ) : (
      /* Tabs */
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="overview">{t('detail.overview')}</TabsTrigger>
          <TabsTrigger value="matching">{t('detail.matching')}</TabsTrigger>
          <TabsTrigger value="tls">{t('detail.tls')}</TabsTrigger>
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
                    <Label className="text-xs text-muted-foreground">{t('form.routeName')}</Label>
                    {isEditing ? (
                      <Input
                        value={formValues.name}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, name: e.target.value }))
                        }
                      />
                    ) : (
                      <p className="font-mono text-sm">{route.name}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t('table.status')}</Label>
                    {isEditing ? (
                      <div className="flex items-center gap-2 pt-1">
                        <Switch
                          checked={formValues.enabled}
                          onCheckedChange={(checked) =>
                            setFormValues((prev) => ({ ...prev, enabled: checked }))
                          }
                        />
                        <span className="text-sm">{formValues.enabled ? tc('status.enabled') : tc('status.disabled')}</span>
                      </div>
                    ) : (
                      <StatusBadge status={route.enabled ? 'healthy' : 'unknown'} label={route.enabled ? tc('status.enabled') : tc('status.disabled')} />
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('detail.serviceTarget')}</Label>
                  {isEditing ? (
                    <SearchableSelect
                      options={services.map((svc: Service): SelectOption => ({
                        value: svc.id,
                        label: svc.name,
                        description: `${svc.upstreams.length} upstream${svc.upstreams.length !== 1 ? 's' : ''}`,
                        badge: `${svc.upstreams.length}`,
                      }))}
                      value={formValues.serviceId}
                      onChange={(val) =>
                        setFormValues((prev) => ({ ...prev, serviceId: val }))
                      }
                      placeholder="Search services..."
                    />
                  ) : (
                    <p className="font-mono text-sm">
                      {route.serviceId ? getServiceName(route.serviceId) : t('detail.noTarget')}
                    </p>
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
                  <p>{route.createdAt ? <TimeAgo date={route.createdAt} /> : '\u2014'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('detail.updatedAt')}</span>
                  <p>{route.updatedAt ? <TimeAgo date={route.updatedAt} /> : '\u2014'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('detail.routeId')}</span>
                  <p className="font-mono text-xs break-all">{route.id}</p>
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
                  {Object.entries(route.labels ?? {}).map(([k, v]) => (
                    <Badge key={k} variant="outline">
                      <span className="font-mono text-xs">{k}</span>
                      <span className="mx-1 text-muted-foreground">=</span>
                      <span className="font-mono text-xs">{v}</span>
                    </Badge>
                  ))}
                  {Object.keys(route.labels ?? {}).length === 0 && (
                    <span className="text-sm text-muted-foreground">No labels</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Matching Tab --- */}
        <TabsContent value="matching">
          <Card>
            <CardHeader>
              <CardTitle>{t('matching.hosts')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t('matching.hostsDescription')}</p>
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
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(route.matchers[0]?.hosts ?? []).map((h, i) => (
                    <Badge key={i} variant="secondary">{h}</Badge>
                  ))}
                  {(route.matchers[0]?.hosts ?? []).length === 0 && (
                    <span className="text-sm text-muted-foreground">All hosts</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('matching.paths')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t('matching.pathsDescription')}</p>
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
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
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
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(route.matchers[0]?.paths ?? []).map((p, i) => (
                    <Badge key={i} variant="outline">
                      <span className="mr-1 text-xs text-muted-foreground">
                        {p.type === 'TYPE_PREFIX' ? 'prefix' : p.type === 'TYPE_EXACT' ? 'exact' : 'regexp'}:
                      </span>
                      {p.value}
                    </Badge>
                  ))}
                  {(route.matchers[0]?.paths ?? []).length === 0 && (
                    <span className="text-sm text-muted-foreground">All paths</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('matching.methods')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
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
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(route.matchers[0]?.methods ?? []).map((m, i) => (
                    <Badge key={i}>{m}</Badge>
                  ))}
                  {(route.matchers[0]?.methods ?? []).length === 0 && (
                    <span className="text-sm text-muted-foreground">All methods</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('matching.headers')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="space-y-2">
                  {formValues.headers.map((header, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={header.name}
                        onChange={(e) => {
                          const next = [...formValues.headers]
                          next[idx] = { ...next[idx], name: e.target.value }
                          setFormValues((prev) => ({ ...prev, headers: next }))
                        }}
                        placeholder={t('matching.headerName')}
                        className="flex-1"
                      />
                      <Input
                        value={header.value}
                        onChange={(e) => {
                          const next = [...formValues.headers]
                          next[idx] = { ...next[idx], value: e.target.value }
                          setFormValues((prev) => ({ ...prev, headers: next }))
                        }}
                        placeholder={t('matching.headerValue')}
                        className="flex-1"
                      />
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={header.invert}
                          onChange={(e) => {
                            const next = [...formValues.headers]
                            next[idx] = { ...next[idx], invert: e.target.checked }
                            setFormValues((prev) => ({ ...prev, headers: next }))
                          }}
                        />
                        {t('matching.headerInvert')}
                      </label>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          const next = formValues.headers.filter((_, i) => i !== idx)
                          setFormValues((prev) => ({ ...prev, headers: next }))
                        }}
                      >
                        <XIcon className="size-3" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setFormValues((prev) => ({
                        ...prev,
                        headers: [...prev.headers, { name: '', value: '', invert: false }],
                      }))
                    }
                  >
                    {t('matching.addHeader')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-1">
                  {(route.matchers[0]?.headers ?? []).map((h, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <code className="font-mono text-xs">{h.name}: {h.value}</code>
                      {h.invert && <Badge variant="outline" className="text-xs">inverted</Badge>}
                    </div>
                  ))}
                  {(route.matchers[0]?.headers ?? []).length === 0 && (
                    <span className="text-sm text-muted-foreground">No header matchers</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- TLS Tab (NEEDS BACKEND) --- */}
        <TabsContent value="tls">
          <NeedsBackendField>
            <Card>
              <CardHeader>
                <CardTitle>{t('tls.forceHttps')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>{t('tls.forceHttps')}</Label>
                    <p className="text-xs text-muted-foreground">{t('tls.forceHttpsDescription')}</p>
                  </div>
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
              </CardContent>
            </Card>
          </NeedsBackendField>
        </TabsContent>

        {/* --- Policies Tab --- */}
        <TabsContent value="policies">
          <Card>
            <CardHeader>
              <CardTitle>{t('policies.attached')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{t('policies.attachedDescription', 'Select policies to attach to this route.')}</p>
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
                    placeholder="Search policies..."
                  />
                </div>
              ) : (route.policyIds ?? []).length > 0 ? (
                <div className="space-y-2">
                  {(route.policyIds ?? []).map((pid) => (
                    <div key={pid} className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <span className="font-mono text-sm">{getPolicyName(pid)}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{pid}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={t('policies.noPolicies')}
                  description={t('policies.noPoliciesDescription')}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Traffic Tab --- */}
        <TabsContent value="traffic">
          <TrafficTab entityType="route" entityId={route.id} />
        </TabsContent>

        {/* --- Activity Tab --- */}
        <TabsContent value="activity">
          <ActivityTimeline entityType="route" entityId={route.id} />
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
