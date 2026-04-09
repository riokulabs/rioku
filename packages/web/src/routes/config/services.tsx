import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ServerIcon,
  MoreHorizontalIcon,
  XIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Service, Upstream } from '@/lib/api'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { StatusBadge } from '@/components/rioku/status-badge'
import { TimeAgo } from '@/components/rioku/time-ago'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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

export const Route = createFileRoute('/config/services')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    }),
  component: ConfigServices,
})

const LB_POLICIES = [
  'LB_POLICY_ROUND_ROBIN',
  'LB_POLICY_RANDOM',
  'LB_POLICY_FIRST',
  'LB_POLICY_LEAST_CONN',
  'LB_POLICY_IP_HASH',
] as const

const TLS_MODES = ['none', 'tls', 'skip-verify'] as const

interface UpstreamRow {
  address: string
  weight: number
  tls: string
}

interface ServiceFormState {
  name: string
  lbPolicy: string
  upstreams: UpstreamRow[]
}

const defaultUpstream: UpstreamRow = {
  address: '',
  weight: 1,
  tls: 'none',
}

const emptyForm: ServiceFormState = {
  name: '',
  lbPolicy: 'LB_POLICY_ROUND_ROBIN',
  upstreams: [{ ...defaultUpstream }],
}

function formFromService(service: Service): ServiceFormState {
  return {
    name: service.name,
    lbPolicy: service.lbPolicy,
    upstreams:
      service.upstreams.length > 0
        ? service.upstreams.map((u) => ({
            address: u.address,
            weight: u.weight,
            tls: u.tls,
          }))
        : [{ ...defaultUpstream }],
  }
}

function ConfigServices() {
  const { t } = useTranslation('services')
  const queryClient = useQueryClient()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingService, setEditingService] = useState<Service | null>(null)
  const [form, setForm] = useState<ServiceFormState>(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null)

  const config = Route.useLoaderData()
  const services = config.services

  const saveMutation = useMutation({
    mutationFn: (payload: {
      service: { action: 'UPSERT'; service: Partial<Service> }
    }) => apiClient.post('/config', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success(
        editingService
          ? t('messages.serviceUpdated')
          : t('messages.serviceCreated'),
      )
      closeSheet()
    },
    onError: () => {
      toast.error('Failed to save service')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post('/config', {
        service: { action: 'DELETE', id },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success(t('messages.serviceDeleted'))
      setDeleteTarget(null)
    },
    onError: () => {
      toast.error('Failed to delete service')
    },
  })

  function openCreate() {
    setEditingService(null)
    setForm(emptyForm)
    setSheetOpen(true)
  }

  function openEdit(service: Service) {
    setEditingService(service)
    setForm(formFromService(service))
    setSheetOpen(true)
  }

  function closeSheet() {
    setSheetOpen(false)
    setEditingService(null)
    setForm(emptyForm)
  }

  function addUpstream() {
    setForm((prev) => ({
      ...prev,
      upstreams: [...prev.upstreams, { ...defaultUpstream }],
    }))
  }

  function removeUpstream(index: number) {
    setForm((prev) => ({
      ...prev,
      upstreams: prev.upstreams.filter((_, i) => i !== index),
    }))
  }

  function updateUpstream(index: number, field: keyof UpstreamRow, value: string | number) {
    setForm((prev) => ({
      ...prev,
      upstreams: prev.upstreams.map((u, i) =>
        i === index ? { ...u, [field]: value } : u,
      ),
    }))
  }

  function handleSave() {
    const validUpstreams: Upstream[] = form.upstreams
      .filter((u) => u.address.trim() !== '')
      .map((u) => ({
        id: '',
        address: u.address.trim(),
        weight: u.weight,
        tls: u.tls,
        healthy: true,
      }))

    const service: Partial<Service> = {
      ...(editingService ? { id: editingService.id } : {}),
      name: form.name,
      lbPolicy: form.lbPolicy,
      upstreams: validUpstreams,
    }

    saveMutation.mutate({
      service: { action: 'UPSERT', service },
    })
  }

  const tableData = services.map((svc) => ({
    ...svc,
    _upstreamCount: svc.upstreams.length,
    _upstreamPreview: svc.upstreams[0]?.address ?? '\u2014',
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button onClick={openCreate}>
            <PlusIcon className="size-4" />
            {t('form.createService')}
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
            key: '_upstreamCount',
            header: t('table.upstreams'),
            render: (r) => (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{r._upstreamCount}</Badge>
                <span className="truncate text-xs text-muted-foreground font-mono">
                  {r._upstreamPreview}
                </span>
              </div>
            ),
          },
          {
            key: 'lbPolicy',
            header: t('table.lbPolicy'),
            render: (r) => (
              <Badge variant="outline">{r.lbPolicy}</Badge>
            ),
          },
          {
            key: '_health',
            header: t('table.health'),
            render: () => (
              <StatusBadge status="healthy" />
            ),
          },
          {
            key: 'updatedAt',
            header: t('table.updated'),
            sortable: true,
            render: (r) =>
              r.updatedAt ? <TimeAgo date={r.updatedAt} /> : '\u2014',
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
                  <DropdownMenuItem onClick={() => openEdit(r as Service)}>
                    <PencilIcon className="size-4" />
                    {t('form.editService')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteTarget(r as Service)}
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
        searchPlaceholder="Search services..."
        pageSize={10}
        emptyState={
          <EmptyState
            icon={<ServerIcon className="size-5" />}
            title={t('empty.noServices')}
            description={t('empty.noServicesDesc')}
            action={
              <Button onClick={openCreate} size="sm">
                <PlusIcon className="size-4" />
                {t('form.createService')}
              </Button>
            }
          />
        }
      />

      {/* Create / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {editingService
                ? t('form.editService')
                : t('form.createService')}
            </SheetTitle>
            <SheetDescription>
              {editingService
                ? 'Modify the service configuration.'
                : 'Define a new upstream service with load balancing.'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-5 px-4 pb-4 overflow-y-auto">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="service-name">{t('form.serviceName')}</Label>
              <Input
                id="service-name"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="backend-api"
              />
            </div>

            {/* LB Policy */}
            <div className="space-y-2">
              <Label>{t('form.lbPolicy')}</Label>
              <Select
                value={form.lbPolicy}
                onValueChange={(val) =>
                  setForm((prev) => ({ ...prev, lbPolicy: val ?? 'LB_POLICY_ROUND_ROBIN' }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LB_POLICIES.map((policy) => (
                    <SelectItem key={policy} value={policy}>
                      {policy}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Upstreams */}
            <fieldset className="space-y-3">
              <div className="flex items-center justify-between">
                <legend className="text-sm font-medium">
                  {t('table.upstreams')}
                </legend>
                <Button variant="outline" size="xs" onClick={addUpstream}>
                  <PlusIcon className="size-3" />
                  {t('form.addUpstream')}
                </Button>
              </div>

              <div className="space-y-3">
                {form.upstreams.map((upstream, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-2 rounded-lg border p-3"
                  >
                    <div className="flex-1 space-y-2">
                      <div className="space-y-1">
                        <Label className="text-xs">{t('form.address')}</Label>
                        <Input
                          value={upstream.address}
                          onChange={(e) =>
                            updateUpstream(index, 'address', e.target.value)
                          }
                          placeholder="10.0.1.10:8080"
                          className="h-7 text-xs"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">{t('form.weight')}</Label>
                          <Input
                            type="number"
                            min={0}
                            value={upstream.weight}
                            onChange={(e) =>
                              updateUpstream(
                                index,
                                'weight',
                                parseInt(e.target.value, 10) || 0,
                              )
                            }
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{t('form.tlsMode')}</Label>
                          <Select
                            value={upstream.tls}
                            onValueChange={(val) =>
                              updateUpstream(index, 'tls', val ?? 'none')
                            }
                          >
                            <SelectTrigger className="h-7 w-full text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TLS_MODES.map((mode) => (
                                <SelectItem key={mode} value={mode}>
                                  {mode}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    {form.upstreams.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => removeUpstream(index)}
                        className="mt-5 shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <XIcon className="size-3" />
                        <span className="sr-only">{t('form.removeUpstream')}</span>
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </fieldset>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={handleSave}
                disabled={
                  saveMutation.isPending ||
                  !form.name ||
                  form.upstreams.every((u) => !u.address.trim())
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
        title="Delete Service"
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
