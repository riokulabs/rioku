import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PlusIcon, PencilIcon, TrashIcon, RouteIcon, MoreHorizontalIcon } from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Route as RouteType, Service } from '@/lib/api'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { TimeAgo } from '@/components/rioku/time-ago'
import { Slot } from '@/components/plugin/slot'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export const Route = createFileRoute('/config/routes')({
  component: ConfigRoutes,
})

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

interface RouteFormState {
  name: string
  hostPatterns: string
  pathPatterns: string
  methods: string[]
  targetService: string
  enabled: boolean
}

const emptyForm: RouteFormState = {
  name: '',
  hostPatterns: '',
  pathPatterns: '',
  methods: [],
  targetService: '',
  enabled: true,
}

function formFromRoute(route: RouteType): RouteFormState {
  const matcher = route.matchers[0]
  return {
    name: route.name,
    hostPatterns: matcher?.host?.join(', ') ?? '',
    pathPatterns: matcher?.path?.join(', ') ?? '',
    methods: matcher?.method ?? [],
    targetService: route.target_service,
    enabled: route.enabled,
  }
}

function ConfigRoutes() {
  const { t } = useTranslation('routes')
  const queryClient = useQueryClient()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingRoute, setEditingRoute] = useState<RouteType | null>(null)
  const [form, setForm] = useState<RouteFormState>(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<RouteType | null>(null)

  const configQuery = useQuery({
    queryKey: ['config'],
    queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
  })

  const routes = configQuery.data?.routes ?? []
  const services = configQuery.data?.services ?? []

  const saveMutation = useMutation({
    mutationFn: (payload: {
      operation: 'create_route' | 'update_route'
      route: Partial<RouteType>
    }) => apiClient.post('/config', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success(editingRoute ? t('messages.routeUpdated') : t('messages.routeCreated'))
      closeSheet()
    },
    onError: () => {
      toast.error('Failed to save route')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post('/config', { operation: 'delete_route', route: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success(t('messages.routeDeleted'))
      setDeleteTarget(null)
    },
    onError: () => {
      toast.error('Failed to delete route')
    },
  })

  const toggleMutation = useMutation({
    mutationFn: (route: RouteType) =>
      apiClient.post('/config', {
        operation: 'update_route',
        route: { id: route.id, enabled: !route.enabled },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
  })

  function openCreate() {
    setEditingRoute(null)
    setForm(emptyForm)
    setSheetOpen(true)
  }

  function openEdit(route: RouteType) {
    setEditingRoute(route)
    setForm(formFromRoute(route))
    setSheetOpen(true)
  }

  function closeSheet() {
    setSheetOpen(false)
    setEditingRoute(null)
    setForm(emptyForm)
  }

  function handleSave() {
    const hosts = form.hostPatterns
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const paths = form.pathPatterns
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const route: Partial<RouteType> = {
      ...(editingRoute ? { id: editingRoute.id } : {}),
      name: form.name,
      matchers: [
        {
          ...(hosts.length > 0 ? { host: hosts } : {}),
          ...(paths.length > 0 ? { path: paths } : {}),
          ...(form.methods.length > 0 ? { method: form.methods } : {}),
        },
      ],
      target_service: form.targetService,
      enabled: form.enabled,
    }

    saveMutation.mutate({
      operation: editingRoute ? 'update_route' : 'create_route',
      route,
    })
  }

  function toggleMethod(method: string) {
    setForm((prev) => ({
      ...prev,
      methods: prev.methods.includes(method)
        ? prev.methods.filter((m) => m !== method)
        : [...prev.methods, method],
    }))
  }

  if (configQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-4 w-64" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    )
  }

  const tableData = routes.map((r) => ({
    ...r,
    _matcherDisplay: r.matchers
      .flatMap((m) => [...(m.host ?? []), ...(m.path ?? [])])
      .join(', '),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button onClick={openCreate}>
            <PlusIcon className="size-4" />
            {t('form.createRoute')}
          </Button>
        }
      />

      <DataTable
        columns={[
          {
            key: 'name',
            header: t('table.name'),
            sortable: true,
            render: (r) => (
              <span className="font-mono text-sm">{r.name}</span>
            ),
          },
          {
            key: '_matcherDisplay',
            header: t('table.matchers'),
            render: (r) => (
              <div className="flex flex-wrap gap-1">
                {r.matchers.flatMap((m, mi) => [
                  ...(m.host ?? []).map((h, hi) => (
                    <Badge key={`h-${mi}-${hi}`} variant="secondary">
                      {h}
                    </Badge>
                  )),
                  ...(m.path ?? []).map((p, pi) => (
                    <Badge key={`p-${mi}-${pi}`} variant="outline">
                      {p}
                    </Badge>
                  )),
                ])}
              </div>
            ),
          },
          {
            key: 'target_service',
            header: t('table.targetService'),
            render: (r) => (
              <span className="font-mono text-sm text-muted-foreground">
                {r.target_service}
              </span>
            ),
          },
          {
            key: 'enabled',
            header: t('table.status'),
            render: (r) => (
              <Switch
                checked={r.enabled}
                onCheckedChange={() => toggleMutation.mutate(r as RouteType)}
              />
            ),
          },
          {
            key: 'updated_at',
            header: t('table.updated'),
            sortable: true,
            render: (r) =>
              r.updated_at ? <TimeAgo date={r.updated_at} /> : '\u2014',
          },
          {
            key: '_actions',
            header: '',
            render: (r) => (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" />}
                >
                  <MoreHorizontalIcon className="size-4" />
                  <span className="sr-only">{t('table.actions')}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEdit(r as RouteType)}>
                    <PencilIcon className="size-4" />
                    {t('form.editRoute')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteTarget(r as RouteType)}
                  >
                    <TrashIcon className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]}
        data={tableData}
        searchable
        searchPlaceholder="Search routes..."
        pageSize={10}
        emptyState={
          <EmptyState
            icon={<RouteIcon className="size-5" />}
            title={t('empty.noRoutes')}
            description={t('empty.noRoutesDesc')}
            action={
              <Button onClick={openCreate} size="sm">
                <PlusIcon className="size-4" />
                {t('form.createRoute')}
              </Button>
            }
          />
        }
      />

      <Slot zone="route.detail.tabs" />

      {/* Create / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {editingRoute ? t('form.editRoute') : t('form.createRoute')}
            </SheetTitle>
            <SheetDescription>
              {editingRoute
                ? 'Modify the route configuration.'
                : 'Define a new routing rule for incoming requests.'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-5 px-4 pb-4 overflow-y-auto">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="route-name">{t('form.routeName')}</Label>
              <Input
                id="route-name"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="api-gateway"
              />
            </div>

            {/* Matchers */}
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">{t('table.matchers')}</legend>

              <div className="space-y-2">
                <Label htmlFor="host-patterns">{t('form.matchHost')}</Label>
                <Input
                  id="host-patterns"
                  value={form.hostPatterns}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, hostPatterns: e.target.value }))
                  }
                  placeholder="api.example.com, *.example.com"
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated host patterns
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="path-patterns">{t('form.matchPath')}</Label>
                <Input
                  id="path-patterns"
                  value={form.pathPatterns}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, pathPatterns: e.target.value }))
                  }
                  placeholder="/v1/*, /api/*"
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated path patterns
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t('form.matchMethod')}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {HTTP_METHODS.map((method) => (
                    <Button
                      key={method}
                      variant={
                        form.methods.includes(method) ? 'default' : 'outline'
                      }
                      size="xs"
                      onClick={() => toggleMethod(method)}
                    >
                      {method}
                    </Button>
                  ))}
                </div>
              </div>
            </fieldset>

            {/* Target service */}
            <div className="space-y-2">
              <Label>{t('form.targetService')}</Label>
              <Select
                value={form.targetService}
                onValueChange={(val) =>
                  setForm((prev) => ({ ...prev, targetService: val ?? '' }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a service" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((svc: Service) => (
                    <SelectItem key={svc.id} value={svc.name}>
                      {svc.name}
                    </SelectItem>
                  ))}
                  {services.length === 0 && (
                    <SelectItem value="" disabled>
                      No services available
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Enabled toggle */}
            <div className="flex items-center justify-between">
              <Label htmlFor="route-enabled">{t('form.enabled')}</Label>
              <Switch
                id="route-enabled"
                checked={form.enabled}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, enabled: checked }))
                }
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={handleSave}
                disabled={
                  saveMutation.isPending || !form.name || !form.targetService
                }
              >
                {saveMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" onClick={closeSheet}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete Route"
        description={t('messages.confirmDelete')}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
        }}
      />
    </div>
  )
}
