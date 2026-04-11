import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PolicyFormProps } from './types'

const WINDOW_UNITS = ['second', 'minute', 'hour', 'day'] as const
const SCOPES = ['per_ip', 'per_api_key', 'per_agent', 'per_route', 'global'] as const
const RESPONSES = ['429', '503', 'drop'] as const

export function RateLimitForm({ value, onChange, errors, readOnly }: PolicyFormProps) {
  function set(key: string, val: unknown) {
    onChange({ ...value, [key]: val })
  }

  const tokenAware = Boolean(value.tokenAware)
  const costAware = Boolean(value.costAware)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="requestsPerWindow">Requests per window</Label>
          <Input
            id="requestsPerWindow"
            type="number"
            min={1}
            value={value.requestsPerWindow as number ?? ''}
            onChange={(e) => set('requestsPerWindow', parseInt(e.target.value) || 0)}
            disabled={readOnly}
          />
          {errors?.requestsPerWindow && (
            <p className="text-xs text-destructive">{errors.requestsPerWindow}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Window unit</Label>
          <Select
            value={value.windowUnit as string ?? 'minute'}
            onValueChange={(v) => set('windowUnit', v)}
            disabled={readOnly}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_UNITS.map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Scope</Label>
        <Select
          value={value.scope as string ?? 'per_ip'}
          onValueChange={(v) => set('scope', v)}
          disabled={readOnly}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPES.map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="tokenAware">Token-aware rate limiting</Label>
        <Switch
          id="tokenAware"
          checked={tokenAware}
          onCheckedChange={(v) => set('tokenAware', v)}
          disabled={readOnly}
        />
      </div>

      {tokenAware && (
        <div className="grid gap-4 sm:grid-cols-3 pl-4 border-l-2">
          <div className="space-y-2">
            <Label htmlFor="inputTokenLimit">Input token limit</Label>
            <Input
              id="inputTokenLimit"
              type="number"
              min={1}
              value={value.inputTokenLimit as number ?? ''}
              onChange={(e) => set('inputTokenLimit', parseInt(e.target.value) || undefined)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="outputTokenLimit">Output token limit</Label>
            <Input
              id="outputTokenLimit"
              type="number"
              min={1}
              value={value.outputTokenLimit as number ?? ''}
              onChange={(e) => set('outputTokenLimit', parseInt(e.target.value) || undefined)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="totalTokenLimit">Total token limit</Label>
            <Input
              id="totalTokenLimit"
              type="number"
              min={1}
              value={value.totalTokenLimit as number ?? ''}
              onChange={(e) => set('totalTokenLimit', parseInt(e.target.value) || undefined)}
              disabled={readOnly}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Label htmlFor="costAware">Cost-aware rate limiting</Label>
        <Switch
          id="costAware"
          checked={costAware}
          onCheckedChange={(v) => set('costAware', v)}
          disabled={readOnly}
        />
      </div>

      {costAware && (
        <div className="pl-4 border-l-2 space-y-2">
          <Label htmlFor="dailyBudgetUsd">Daily budget (USD)</Label>
          <Input
            id="dailyBudgetUsd"
            type="number"
            min={0}
            step={0.01}
            value={value.dailyBudgetUsd as number ?? ''}
            onChange={(e) => set('dailyBudgetUsd', parseFloat(e.target.value) || undefined)}
            disabled={readOnly}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="burstAllowance">Burst allowance</Label>
          <Input
            id="burstAllowance"
            type="number"
            min={0}
            value={value.burstAllowance as number ?? ''}
            onChange={(e) => set('burstAllowance', parseInt(e.target.value) || 0)}
            disabled={readOnly}
          />
        </div>

        <div className="space-y-2">
          <Label>Response when limited</Label>
          <Select
            value={value.responseWhenLimited as string ?? '429'}
            onValueChange={(v) => set('responseWhenLimited', v)}
            disabled={readOnly}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESPONSES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r === '429' ? '429 Too Many Requests' : r === '503' ? '503 Service Unavailable' : 'Drop connection'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
