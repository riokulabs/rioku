import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ShieldIcon,
  MoreHorizontalIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, Policy, Route as RouteType } from '@/lib/api'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { TimeAgo } from '@/components/rioku/time-ago'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
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

export const Route = createFileRoute('/config/policies')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData({
      queryKey: ['config'],
      queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    }),
  component: ConfigPolicies,
})

const POLICY_TYPES = [
  'rate-limit',
  'authentication',
  'cors',
  'circuit-breaker',
  'retry',
  'cache',
  'transform',
] as const

const policyTypeColors: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  'rate-limit': 'default',
  'authentication': 'secondary',
  'cors': 'outline',
  'circuit-breaker': 'destructive',
  'retry': 'secondary',
  'cache': 'outline',
  'transform': 'default',
}

interface PolicyFormState {
  name: string
  type: string
  configJson: string
}

const emptyForm: PolicyFormState = {
  name: '',
  type: 'rate-limit',
  configJson: '{\n  \n}',
}

function formFromPolicy(policy: Policy): PolicyFormState {
  return {
    name: policy.name,
    type: policy.type,
    configJson: JSON.stringify(policy.config, null, 2),
  }
}

function ConfigPolicies() {
  const { t } = useTranslation('policies')
  const queryClient = useQueryClient()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null)
  const [form, setForm] = useState<PolicyFormState>(emptyForm)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Policy | null>(null)

  const config = Route.useLoaderData()
  const policies = config.policies
  const routes = config.routes

  // Count routes that reference each policy
  function countAttachedRoutes(policyId: string): number {
    return routes.filter((r: RouteType) => r.policy_ids.includes(policyId)).length
  }

  const saveMutation = useMutation({
    mutationFn: (payload: {
      operation: 'create_policy' | 'update_policy'
      policy: Partial<Policy>
    }) => apiClient.post('/config', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success(
        editingPolicy
          ? t('messages.policyUpdated')
          : t('messages.policyCreated'),
      )
      closeSheet()
    },
    onError: () => {
      toast.error('Failed to save policy')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post('/config', {
        operation: 'delete_policy',
        policy: { id },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success(t('messages.policyDeleted'))
      setDeleteTarget(null)
    },
    onError: () => {
      toast.error('Failed to delete policy')
    },
  })

  function openCreate() {
    setEditingPolicy(null)
    setForm(emptyForm)
    setJsonError(null)
    setSheetOpen(true)
  }

  function openEdit(policy: Policy) {
    setEditingPolicy(policy)
    setForm(formFromPolicy(policy))
    setJsonError(null)
    setSheetOpen(true)
  }

  function closeSheet() {
    setSheetOpen(false)
    setEditingPolicy(null)
    setForm(emptyForm)
    setJsonError(null)
  }

  function handleConfigChange(value: string) {
    setForm((prev) => ({ ...prev, configJson: value }))
    try {
      JSON.parse(value)
      setJsonError(null)
    } catch (e) {
      setJsonError((e as Error).message)
    }
  }

  function handleSave() {
    let config: Record<string, unknown>
    try {
      config = JSON.parse(form.configJson)
    } catch {
      setJsonError('Invalid JSON')
      return
    }

    const policy: Partial<Policy> = {
      ...(editingPolicy ? { id: editingPolicy.id } : {}),
      name: form.name,
      type: form.type,
      config,
    }

    saveMutation.mutate({
      operation: editingPolicy ? 'update_policy' : 'create_policy',
      policy,
    })
  }

  const tableData = policies.map((p) => ({
    ...p,
    _attachedCount: countAttachedRoutes(p.id),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button onClick={openCreate}>
            <PlusIcon className="size-4" />
            {t('form.createPolicy')}
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
            key: 'type',
            header: t('table.type'),
            render: (r) => (
              <Badge variant={policyTypeColors[r.type] ?? 'outline'}>
                {r.type}
              </Badge>
            ),
          },
          {
            key: '_attachedCount',
            header: t('table.attachedTo'),
            render: (r) => (
              <span className="text-sm text-muted-foreground">
                {r._attachedCount === 0
                  ? 'No routes'
                  : `${r._attachedCount} route${r._attachedCount === 1 ? '' : 's'}`}
              </span>
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
                  <DropdownMenuItem onClick={() => openEdit(r as unknown as Policy)}>
                    <PencilIcon className="size-4" />
                    {t('form.editPolicy')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteTarget(r as unknown as Policy)}
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
        searchPlaceholder="Search policies..."
        pageSize={10}
        emptyState={
          <EmptyState
            icon={<ShieldIcon className="size-5" />}
            title={t('empty.noPolicies')}
            description={t('empty.noPoliciesDesc')}
            action={
              <Button onClick={openCreate} size="sm">
                <PlusIcon className="size-4" />
                {t('form.createPolicy')}
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
              {editingPolicy
                ? t('form.editPolicy')
                : t('form.createPolicy')}
            </SheetTitle>
            <SheetDescription>
              {editingPolicy
                ? 'Modify the policy configuration.'
                : 'Create a new traffic policy for your routes.'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-5 px-4 pb-4 overflow-y-auto">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="policy-name">{t('form.policyName')}</Label>
              <Input
                id="policy-name"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="rate-limit-global"
              />
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label>{t('form.policyType')}</Label>
              <Select
                value={form.type}
                onValueChange={(val) =>
                  setForm((prev) => ({ ...prev, type: val ?? 'rate-limit' }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POLICY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Config JSON */}
            <div className="space-y-2">
              <Label htmlFor="policy-config">{t('form.policyConfig')}</Label>
              <Textarea
                id="policy-config"
                value={form.configJson}
                onChange={(e) => handleConfigChange(e.target.value)}
                className="min-h-48 font-mono text-xs"
                placeholder='{ "requests_per_second": 100 }'
                spellCheck={false}
              />
              {jsonError && (
                <p className="text-xs text-destructive">{jsonError}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={handleSave}
                disabled={
                  saveMutation.isPending ||
                  !form.name ||
                  jsonError !== null
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
        title="Delete Policy"
        description={
          deleteTarget && countAttachedRoutes(deleteTarget.id) > 0
            ? `This policy is attached to ${countAttachedRoutes(deleteTarget.id)} route(s). Deleting it will remove it from those routes. ${t('messages.confirmDelete')}`
            : t('messages.confirmDelete')
        }
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
