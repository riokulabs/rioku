import { PlusIcon, TrashIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@rioku/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { PermissionRule } from '@/lib/api'

const RESOURCES = ['routes', 'services', 'policies', 'keys', 'users', 'roles', 'settings', 'cluster', 'plugins', 'audit', 'traffic', 'certificates']
const ACTIONS = ['view', 'create', 'update', 'delete', 'manage']
const SCOPES = ['all', 'owned', 'labeled', 'specific'] as const
const EFFECTS = ['allow', 'deny'] as const

interface PermissionRuleEditorProps {
  value: PermissionRule[]
  onChange: (rules: PermissionRule[]) => void
  readOnly?: boolean
}

export function PermissionRuleEditor({ value, onChange, readOnly }: PermissionRuleEditorProps) {
  function addRule() {
    onChange([...value, { id: crypto.randomUUID(), resource: 'routes', actions: ['view'], scope: 'all', effect: 'allow' }])
  }

  function removeRule(id: string) {
    onChange(value.filter((r) => r.id !== id))
  }

  function updateRule(id: string, field: string, val: unknown) {
    onChange(value.map((r) => r.id === id ? { ...r, [field]: val } : r))
  }

  function toggleAction(id: string, action: string) {
    const rule = value.find((r) => r.id === id)
    if (!rule) return
    const actions = rule.actions.includes(action) ? rule.actions.filter((a) => a !== action) : [...rule.actions, action]
    updateRule(id, 'actions', actions)
  }

  return (
    <div className="space-y-3">
      {value.map((rule) => (
        <div key={rule.id} className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <div className="space-y-1 flex-1">
                <Label className="text-xs">Resource</Label>
                <Select value={rule.resource} onValueChange={(v) => updateRule(rule.id, 'resource', v)} disabled={readOnly}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RESOURCES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Effect</Label>
                <Select value={rule.effect} onValueChange={(v) => updateRule(rule.id, 'effect', v)} disabled={readOnly}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EFFECTS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!readOnly && (
              <Button variant="ghost" size="icon-sm" onClick={() => removeRule(rule.id)}>
                <TrashIcon className="size-4" />
                <span className="sr-only">Remove rule</span>
              </Button>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Actions</Label>
            <div className="flex flex-wrap gap-3">
              {ACTIONS.map((a) => (
                <label key={a} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={rule.actions.includes(a)} onChange={() => toggleAction(rule.id, a)} disabled={readOnly} />
                  {a}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Scope</Label>
              <Select value={rule.scope} onValueChange={(v) => updateRule(rule.id, 'scope', v)} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {(rule.scope === 'labeled' || rule.scope === 'specific') && (
              <div className="space-y-1">
                <Label className="text-xs">Scope value</Label>
                <Input value={rule.scopeValue ?? ''} onChange={(e) => updateRule(rule.id, 'scopeValue', e.target.value)} disabled={readOnly} placeholder={rule.scope === 'labeled' ? 'label:value' : 'resource-id'} />
              </div>
            )}
          </div>
        </div>
      ))}
      {!readOnly && (
        <Button variant="outline" size="sm" onClick={addRule}>
          <PlusIcon className="size-4" /> Add rule
        </Button>
      )}
    </div>
  )
}
