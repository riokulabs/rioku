import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DurationInput } from '@/components/rioku/duration-input'
import { TagInput } from '@/components/rioku/tag-input'
import type { PolicyFormProps } from './types'

const BACKOFF_STRATEGIES = ['none', 'constant', 'exponential'] as const

export function RetryForm({ value, onChange, errors, readOnly }: PolicyFormProps) {
  function set(key: string, val: unknown) {
    onChange({ ...value, [key]: val })
  }

  const strategy = (value.backoffStrategy as string) ?? 'none'
  const statusCodes = ((value.retryOnStatusCodes as number[]) ?? [502, 503, 504]).map(String)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="maxAttempts">Max attempts</Label>
        <Input
          id="maxAttempts"
          type="number"
          min={1}
          value={value.maxAttempts as number ?? ''}
          onChange={(e) => set('maxAttempts', parseInt(e.target.value) || 0)}
          disabled={readOnly}
        />
        {errors?.maxAttempts && <p className="text-xs text-destructive">{errors.maxAttempts}</p>}
      </div>

      <div className="space-y-2">
        <Label>Retry on status codes</Label>
        <TagInput
          value={statusCodes}
          onChange={(tags) => set('retryOnStatusCodes', tags.map(Number).filter((n) => !isNaN(n)))}
          label="Retry on status codes"
          placeholder="e.g. 502, 503, 504"
        />
      </div>

      <div className="space-y-2">
        <Label>Backoff strategy</Label>
        <Select
          value={strategy}
          onValueChange={(v) => set('backoffStrategy', v)}
          disabled={readOnly}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BACKOFF_STRATEGIES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {strategy !== 'none' && (
        <div className="grid gap-4 sm:grid-cols-2 pl-4 border-l-2">
          <div className="space-y-2">
            <Label>Initial backoff</Label>
            <DurationInput
              value={value.initialBackoff as string ?? '1s'}
              onChange={(v) => set('initialBackoff', v)}
            />
          </div>

          {strategy === 'exponential' && (
            <div className="space-y-2">
              <Label>Max backoff</Label>
              <DurationInput
                value={value.maxBackoff as string ?? '30s'}
                onChange={(v) => set('maxBackoff', v)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
