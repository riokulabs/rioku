import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@rioku/ui'
import { TagInput } from '@/components/rioku/tag-input'
import { DurationInput } from '@/components/rioku/duration-input'
import type { PolicyFormProps } from './types'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export function CorsForm({ value, onChange, errors, readOnly }: PolicyFormProps) {
  function set(key: string, val: unknown) {
    onChange({ ...value, [key]: val })
  }

  const allowedMethods = (value.allowedMethods as string[]) ?? []

  function toggleMethod(method: string) {
    if (allowedMethods.includes(method)) {
      set('allowedMethods', allowedMethods.filter((m) => m !== method))
    } else {
      set('allowedMethods', [...allowedMethods, method])
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Allowed origins</Label>
        <TagInput
          value={(value.allowedOrigins as string[]) ?? []}
          onChange={(tags) => set('allowedOrigins', tags)}
          placeholder="e.g. https://example.com or *"
        />
        {errors?.allowedOrigins && <p className="text-xs text-destructive">{errors.allowedOrigins}</p>}
      </div>

      <div className="space-y-2">
        <Label>Allowed methods</Label>
        <div className="flex flex-wrap gap-3">
          {HTTP_METHODS.map((m) => (
            <label key={m} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={allowedMethods.includes(m)}
                onCheckedChange={() => toggleMethod(m)}
                disabled={readOnly}
              />
              {m}
            </label>
          ))}
        </div>
        {errors?.allowedMethods && <p className="text-xs text-destructive">{errors.allowedMethods}</p>}
      </div>

      <div className="space-y-2">
        <Label>Allowed headers</Label>
        <TagInput
          value={(value.allowedHeaders as string[]) ?? []}
          onChange={(tags) => set('allowedHeaders', tags)}
          placeholder="e.g. Content-Type, Authorization"
        />
      </div>

      <div className="space-y-2">
        <Label>Exposed headers</Label>
        <TagInput
          value={(value.exposedHeaders as string[]) ?? []}
          onChange={(tags) => set('exposedHeaders', tags)}
          placeholder="e.g. X-Request-Id"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Max age</Label>
          <DurationInput
            value={value.maxAge as string ?? '3600s'}
            onChange={(v) => set('maxAge', v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="allowCredentials">Allow credentials</Label>
          <Switch
            id="allowCredentials"
            checked={Boolean(value.allowCredentials)}
            onCheckedChange={(v) => set('allowCredentials', v)}
            disabled={readOnly}
          />
        </div>
      </div>
    </div>
  )
}
