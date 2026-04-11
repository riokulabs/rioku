import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PolicyFormProps } from './types'

export function AuthApiKeyForm({ value, onChange, errors, readOnly }: PolicyFormProps) {
  function set(key: string, val: unknown) {
    onChange({ ...value, [key]: val })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="headerName">Header name</Label>
        <Input
          id="headerName"
          value={value.headerName as string ?? 'X-API-Key'}
          onChange={(e) => set('headerName', e.target.value)}
          placeholder="X-API-Key"
          disabled={readOnly}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="queryParamName">Query parameter name (optional)</Label>
        <Input
          id="queryParamName"
          value={value.queryParamName as string ?? ''}
          onChange={(e) => set('queryParamName', e.target.value)}
          placeholder="api_key"
          disabled={readOnly}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="prefix">Key prefix (optional)</Label>
        <Input
          id="prefix"
          value={value.prefix as string ?? ''}
          onChange={(e) => set('prefix', e.target.value)}
          placeholder="rku_"
          disabled={readOnly}
        />
      </div>
    </div>
  )
}
