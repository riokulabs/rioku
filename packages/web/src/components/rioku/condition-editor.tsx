import { PlusIcon, TrashIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TagInput } from '@/components/rioku/tag-input'
import type { AccessCondition } from '@/lib/api'

const CONDITION_TYPES = ['time', 'ip', 'mfa', 'geo', 'device', 'custom'] as const

interface ConditionEditorProps {
  value: AccessCondition[]
  onChange: (conditions: AccessCondition[]) => void
}

export function ConditionEditor({ value, onChange }: ConditionEditorProps) {
  function addCondition() {
    onChange([...value, { type: 'ip', config: { cidrRanges: [], negate: false } }])
  }

  function removeCondition(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }

  function updateCondition(i: number, cond: AccessCondition) {
    onChange(value.map((c, idx) => idx === i ? cond : c))
  }

  function changeType(i: number, type: AccessCondition['type']) {
    const defaults: Record<string, Record<string, unknown>> = {
      time: { startTime: '09:00', endTime: '17:00', daysOfWeek: [], timezone: 'UTC' },
      ip: { cidrRanges: [], negate: false },
      mfa: { required: true },
      geo: { countryCodes: [], negate: false },
      device: { allowedUserAgents: [] },
      custom: { expression: '' },
    }
    updateCondition(i, { type, config: defaults[type] ?? {} })
  }

  return (
    <div className="space-y-3">
      {value.map((cond, i) => (
        <div key={i} className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Select value={cond.type} onValueChange={(v) => changeType(i, v as AccessCondition['type'])}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONDITION_TYPES.map((t) => <SelectItem key={t} value={t}>{t === 'ip' ? 'IP Range' : t === 'mfa' ? 'MFA Required' : t === 'geo' ? 'Geolocation' : t === 'custom' ? 'Custom (CEL)' : t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon-sm" onClick={() => removeCondition(i)}>
              <TrashIcon className="size-4" />
              <span className="sr-only">Remove condition</span>
            </Button>
          </div>

          {cond.type === 'ip' && (
            <div className="space-y-2">
              <Label>CIDR ranges</Label>
              <TagInput value={(cond.config.cidrRanges as string[]) ?? []} onChange={(tags) => updateCondition(i, { ...cond, config: { ...cond.config, cidrRanges: tags } })} placeholder="e.g. 10.0.0.0/8" />
              <div className="flex items-center gap-2">
                <Switch checked={Boolean(cond.config.negate)} onCheckedChange={(v) => updateCondition(i, { ...cond, config: { ...cond.config, negate: v } })} />
                <Label className="text-sm">Negate (deny these ranges)</Label>
              </div>
            </div>
          )}

          {cond.type === 'time' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Start time</Label>
                <Input type="time" value={(cond.config.startTime as string) ?? '09:00'} onChange={(e) => updateCondition(i, { ...cond, config: { ...cond.config, startTime: e.target.value } })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">End time</Label>
                <Input type="time" value={(cond.config.endTime as string) ?? '17:00'} onChange={(e) => updateCondition(i, { ...cond, config: { ...cond.config, endTime: e.target.value } })} />
              </div>
            </div>
          )}

          {cond.type === 'mfa' && (
            <div className="flex items-center gap-2">
              <Switch checked={Boolean(cond.config.required)} onCheckedChange={(v) => updateCondition(i, { ...cond, config: { required: v } })} />
              <Label className="text-sm">MFA must be enabled</Label>
            </div>
          )}

          {cond.type === 'geo' && (
            <div className="space-y-2">
              <Label>Country codes</Label>
              <TagInput value={(cond.config.countryCodes as string[]) ?? []} onChange={(tags) => updateCondition(i, { ...cond, config: { ...cond.config, countryCodes: tags } })} placeholder="e.g. US, GB, DE" />
              <div className="flex items-center gap-2">
                <Switch checked={Boolean(cond.config.negate)} onCheckedChange={(v) => updateCondition(i, { ...cond, config: { ...cond.config, negate: v } })} />
                <Label className="text-sm">Negate (deny these countries)</Label>
              </div>
            </div>
          )}

          {cond.type === 'device' && (
            <div className="space-y-2">
              <Label>Allowed user agents (regex)</Label>
              <TagInput value={(cond.config.allowedUserAgents as string[]) ?? []} onChange={(tags) => updateCondition(i, { ...cond, config: { allowedUserAgents: tags } })} placeholder="e.g. Mozilla/.*" />
            </div>
          )}

          {cond.type === 'custom' && (
            <div className="space-y-2">
              <Label>CEL expression</Label>
              <Input value={(cond.config.expression as string) ?? ''} onChange={(e) => updateCondition(i, { ...cond, config: { expression: e.target.value } })} placeholder='request.ip in ["10.0.0.0/8"]' className="font-mono text-sm" />
            </div>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addCondition}>
        <PlusIcon className="size-4" /> Add condition
      </Button>
    </div>
  )
}
