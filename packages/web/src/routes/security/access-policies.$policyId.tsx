import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeftIcon, TrashIcon } from 'lucide-react'
import { apiClient } from '@/lib/api'
import type { AccessPolicy, AccessCondition } from '@/lib/api'
import { ConditionEditor } from '@/components/rioku/condition-editor'
import { TagInput } from '@/components/rioku/tag-input'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

export const Route = createFileRoute('/security/access-policies/$policyId')({
  loader: async ({ context, params }) => {
    const policies = await context.queryClient.ensureQueryData({
      queryKey: ['access-policies'],
      queryFn: () => apiClient.get<AccessPolicy[]>('/auth/access-policies'),
    })
    const policy = policies.find((p) => p.id === params.policyId)
    if (!policy) throw new Error('Access policy not found')
    return { policy }
  },
  component: AccessPolicyDetailPage,
})

export function AccessPolicyDetailPage() {
  const { t } = useTranslation('access-policies')
  const { policy } = Route.useLoaderData()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [name, setName] = useState(policy.name)
  const [description, setDescription] = useState(policy.description)
  const [effect, setEffect] = useState<'allow' | 'deny'>(policy.effect)
  const [targetType, setTargetType] = useState<'roles' | 'users'>(policy.targetType)
  const [targetIds, setTargetIds] = useState<string[]>(policy.targetIds)
  const [conditions, setConditions] = useState<AccessCondition[]>(policy.conditions)
  const [priority, setPriority] = useState(policy.priority)
  const [enabled, setEnabled] = useState(policy.enabled)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const isDirty = name !== policy.name
    || description !== policy.description
    || effect !== policy.effect
    || targetType !== policy.targetType
    || JSON.stringify(targetIds) !== JSON.stringify(policy.targetIds)
    || JSON.stringify(conditions) !== JSON.stringify(policy.conditions)
    || priority !== policy.priority
    || enabled !== policy.enabled

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<AccessPolicy>) =>
      apiClient.put<AccessPolicy>(`/auth/access-policies/${policy.id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-policies'] })
      toast.success('Access policy updated')
    },
    onError: () => toast.error('Failed to update access policy'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.del(`/auth/access-policies/${policy.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-policies'] })
      toast.success('Access policy deleted')
      navigate({ to: '/security/access-policies' })
    },
    onError: () => toast.error('Failed to delete access policy'),
  })

  function handleSave() {
    updateMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      effect,
      targetType,
      targetIds,
      conditions,
      priority,
      enabled,
    })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Link to="/security/access-policies" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> {t('detail.backToList')}
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{policy.name}</h1>
          <Badge variant={policy.enabled ? 'default' : 'secondary'}>
            {policy.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ap-name">Name</Label>
              <Input id="ap-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ap-desc">Description</Label>
              <Input id="ap-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Effect</Label>
              <Select value={effect} onValueChange={(v) => setEffect(v as 'allow' | 'deny')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="deny">Deny</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Target Type</Label>
              <Select value={targetType} onValueChange={(v) => setTargetType(v as 'roles' | 'users')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="roles">Roles</SelectItem>
                  <SelectItem value="users">Users</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Target IDs</Label>
            <TagInput
              value={targetIds}
              onChange={setTargetIds}
              label="Target IDs"
              placeholder={targetType === 'roles' ? 'e.g. role-operator' : 'e.g. user-alice'}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ap-priority">Priority</Label>
              <Input id="ap-priority" type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} min={0} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Enabled</Label>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Conditions</CardTitle></CardHeader>
        <CardContent>
          <ConditionEditor value={conditions} onChange={setConditions} />
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={!isDirty || updateMutation.isPending}>
          {updateMutation.isPending ? 'Saving...' : 'Save changes'}
        </Button>
        {isDirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
      </div>

      <Card className="border-destructive/50">
        <CardHeader><CardTitle className="text-destructive">Danger zone</CardTitle></CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            <TrashIcon className="size-4" /> Delete policy
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Access Policy"
        description={`Delete policy "${policy.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  )
}
