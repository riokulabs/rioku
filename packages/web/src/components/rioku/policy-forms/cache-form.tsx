import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@rioku/ui'
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

const CACHEABLE_METHODS = ['GET', 'HEAD', 'POST'] as const

export function CacheForm({ value, onChange, errors, readOnly }: PolicyFormProps) {
  function set(key: string, val: unknown) {
    onChange({ ...value, [key]: val })
  }

  const cacheableMethods = (value.cacheableMethods as string[]) ?? ['GET', 'HEAD']
  const statusCodes = ((value.cacheableStatusCodes as number[]) ?? [200, 301, 302]).map(String)

  function toggleMethod(method: string) {
    if (cacheableMethods.includes(method)) {
      set('cacheableMethods', cacheableMethods.filter((m) => m !== method))
    } else {
      set('cacheableMethods', [...cacheableMethods, method])
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Default max age</Label>
        <DurationInput
          value={value.defaultMaxAge as string ?? '300s'}
          onChange={(v) => set('defaultMaxAge', v)}
        />
        {errors?.defaultMaxAge && <p className="text-xs text-destructive">{errors.defaultMaxAge}</p>}
      </div>

      <div className="space-y-2">
        <Label>Cacheable status codes</Label>
        <TagInput
          value={statusCodes}
          onChange={(tags) => set('cacheableStatusCodes', tags.map(Number).filter((n) => !isNaN(n)))}
          label="Cacheable status codes"
          placeholder="e.g. 200, 301"
        />
      </div>

      <div className="space-y-2">
        <Label>Cacheable methods</Label>
        <div className="flex flex-wrap gap-3">
          {CACHEABLE_METHODS.map((m) => (
            <label key={m} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={cacheableMethods.includes(m)}
                onChange={() => toggleMethod(m)}
                disabled={readOnly}
              />
              {m}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="maxBodySize">Max body size</Label>
          <Input
            id="maxBodySize"
            type="number"
            min={1}
            value={value.maxBodySize as number ?? ''}
            onChange={(e) => set('maxBodySize', parseInt(e.target.value) || undefined)}
            disabled={readOnly}
          />
        </div>

        <div className="space-y-2">
          <Label>Size unit</Label>
          <Select
            value={value.maxBodySizeUnit as string ?? 'MB'}
            onValueChange={(v) => set('maxBodySizeUnit', v)}
            disabled={readOnly}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="KB">KB</SelectItem>
              <SelectItem value="MB">MB</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Vary headers</Label>
        <TagInput
          value={(value.varyHeaders as string[]) ?? []}
          onChange={(tags) => set('varyHeaders', tags)}
          label="Vary headers"
          placeholder="e.g. Accept, Accept-Encoding"
        />
      </div>

      <div className="space-y-2">
        <Label>Stale while revalidate</Label>
        <DurationInput
          value={value.staleWhileRevalidate as string ?? ''}
          onChange={(v) => set('staleWhileRevalidate', v)}
        />
      </div>
    </div>
  )
}
