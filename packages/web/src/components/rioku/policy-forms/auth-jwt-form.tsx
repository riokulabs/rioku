import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { KvEditor } from '@/components/rioku/kv-editor'
import { DurationInput } from '@/components/rioku/duration-input'
import type { PolicyFormProps } from './types'

const TOKEN_LOCATIONS = ['header', 'cookie', 'query'] as const

export function AuthJwtForm({ value, onChange, errors, readOnly }: PolicyFormProps) {
  function set(key: string, val: unknown) {
    onChange({ ...value, [key]: val })
  }

  const requiredClaims = value.requiredClaims as Array<{ key: string; value: string }> ?? []

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="issuerUrl">Issuer URL</Label>
        <Input
          id="issuerUrl"
          type="url"
          value={value.issuerUrl as string ?? ''}
          onChange={(e) => set('issuerUrl', e.target.value)}
          placeholder="https://auth.example.com"
          disabled={readOnly}
        />
        {errors?.issuerUrl && <p className="text-xs text-destructive">{errors.issuerUrl}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="jwksEndpoint">JWKS endpoint</Label>
        <Input
          id="jwksEndpoint"
          type="url"
          value={value.jwksEndpoint as string ?? ''}
          onChange={(e) => set('jwksEndpoint', e.target.value)}
          placeholder="https://auth.example.com/.well-known/jwks.json"
          disabled={readOnly}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="audience">Audience</Label>
        <Input
          id="audience"
          value={value.audience as string ?? ''}
          onChange={(e) => set('audience', e.target.value)}
          placeholder="api.example.com"
          disabled={readOnly}
        />
        {errors?.audience && <p className="text-xs text-destructive">{errors.audience}</p>}
      </div>

      <div className="space-y-2">
        <Label>Required claims</Label>
        <KvEditor
          value={requiredClaims}
          onChange={(pairs) => set('requiredClaims', pairs)}
          keyPlaceholder="Claim name"
          valuePlaceholder="Expected value"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Token location</Label>
          <Select
            value={value.tokenLocation as string ?? 'header'}
            onValueChange={(v) => set('tokenLocation', v)}
            disabled={readOnly}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOKEN_LOCATIONS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l === 'header' ? 'Authorization header' : l === 'cookie' ? 'Cookie' : 'Query parameter'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Clock skew tolerance</Label>
          <DurationInput
            value={value.clockSkewTolerance as string ?? '30s'}
            onChange={(v) => set('clockSkewTolerance', v)}
          />
        </div>
      </div>
    </div>
  )
}
