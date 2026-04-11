import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeftIcon } from 'lucide-react'
import { ConditionEditor } from '@/components/rioku/condition-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import type { AccessCondition } from '@/lib/api'

export const Route = createFileRoute('/security/access-policies/create')({
  component: AccessPolicyCreatePage,
})

export function AccessPolicyCreatePage() {
  const { t } = useTranslation('access-policies')
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [effect, setEffect] = useState<'allow' | 'deny'>('deny')
  const [conditions, setConditions] = useState<AccessCondition[]>([])
  const [enabled, setEnabled] = useState(true)

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
        <Button disabled>{t('list.createPolicy')}</Button>
        <Button variant="outline" render={<Link to="/security/access-policies" />}>Cancel</Button>
      </div>
      <p className="text-xs text-muted-foreground">Access policies require backend support. This form is a preview.</p>
    </div>
  )
}
