import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeftIcon } from 'lucide-react'
import { apiClient } from '@/lib/api'
import type { AccessCondition, AccessPolicy } from '@/lib/api'
import { ConditionEditor } from '@/components/rioku/condition-editor'
import { TagInput } from '@/components/rioku/tag-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

export const Route = createFileRoute('/security/access-policies/create')({
  component: AccessPolicyCreatePage,
})

export function AccessPolicyCreatePage() {
  const { t } = useTranslation('access-policies')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [effect, setEffect] = useState<'allow' | 'deny'>('deny')
  const [targetType, setTargetType] = useState<'roles' | 'users'>('roles')
  const [targetIds, setTargetIds] = useState<string[]>([])
  const [conditions, setConditions] = useState<AccessCondition[]>([])
  const [priority, setPriority] = useState(10)
  const [enabled, setEnabled] = useState(true)

  const createMutation = useMutation({
    mutationFn: (payload: Omit<AccessPolicy, 'id' | 'createdAt' | 'updatedAt'>) =>
      apiClient.post<AccessPolicy>('/auth/access-policies', payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['access-policies'] })
      toast.success('Access policy created')
      navigate({ to: '/security/access-policies/$policyId', params: { policyId: (data as AccessPolicy).id } })
    },
    onError: () => toast.error('Failed to create access policy'),
  })

  function handleCreate() {
    if (!name.trim()) return
    createMutation.mutate({
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

  const isValid = name.trim().length > 0

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Link to="/security/access-policies" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> {t('detail.backToList')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Create access policy</h1>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ap-name">Name</Label>
            <Input id="ap-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="office-hours-only" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ap-desc">Description</Label>
            <Input id="ap-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
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
        <Button onClick={handleCreate} disabled={!isValid || createMutation.isPending}>
          {createMutation.isPending ? 'Creating...' : t('list.createPolicy')}
        </Button>
        <Button variant="outline" render={<Link to="/security/access-policies" />}>Cancel</Button>
      </div>
    </div>
  )
}
