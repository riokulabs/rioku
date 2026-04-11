import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DurationInput } from '@/components/rioku/duration-input'
import { TagInput } from '@/components/rioku/tag-input'
import type { PolicyFormProps } from './types'

export function CircuitBreakerForm({ value, onChange, errors, readOnly }: PolicyFormProps) {
  function set(key: string, val: unknown) {
    onChange({ ...value, [key]: val })
  }

  const statusCodes = ((value.monitoredStatusCodes as number[]) ?? []).map(String)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="failureThreshold">Failure threshold</Label>
          <Input
            id="failureThreshold"
            type="number"
            min={1}
            value={value.failureThreshold as number ?? ''}
            onChange={(e) => set('failureThreshold', parseInt(e.target.value) || 0)}
            disabled={readOnly}
          />
          {errors?.failureThreshold && <p className="text-xs text-destructive">{errors.failureThreshold}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="successThreshold">Success threshold</Label>
          <Input
            id="successThreshold"
            type="number"
            min={1}
            value={value.successThreshold as number ?? ''}
            onChange={(e) => set('successThreshold', parseInt(e.target.value) || 0)}
            disabled={readOnly}
          />
          {errors?.successThreshold && <p className="text-xs text-destructive">{errors.successThreshold}</p>}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Timeout</Label>
        <DurationInput
          value={value.timeout as string ?? '30s'}
          onChange={(v) => set('timeout', v)}
        />
        {errors?.timeout && <p className="text-xs text-destructive">{errors.timeout}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="maxRequestsHalfOpen">Max requests (half-open)</Label>
        <Input
          id="maxRequestsHalfOpen"
          type="number"
          min={1}
          value={value.maxRequestsHalfOpen as number ?? ''}
          onChange={(e) => set('maxRequestsHalfOpen', parseInt(e.target.value) || undefined)}
          disabled={readOnly}
        />
      </div>

      <div className="space-y-2">
        <Label>Monitored status codes</Label>
        <TagInput
          value={statusCodes}
          onChange={(tags) => set('monitoredStatusCodes', tags.map(Number).filter((n) => !isNaN(n)))}
          placeholder="e.g. 500, 502, 503"
        />
      </div>
    </div>
  )
}
