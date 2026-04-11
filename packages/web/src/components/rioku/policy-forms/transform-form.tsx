import { PlusIcon, TrashIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PolicyFormProps } from './types'

interface HeaderOp {
  action: string
  name: string
  value?: string
}

interface QueryOp {
  action: string
  key: string
  value?: string
}

const HEADER_ACTIONS = ['set', 'add', 'delete', 'replace'] as const
const QUERY_ACTIONS = ['add', 'remove', 'set'] as const

function HeaderOpsEditor({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string
  value: HeaderOp[]
  onChange: (ops: HeaderOp[]) => void
  readOnly?: boolean
}) {
  function addOp() {
    onChange([...value, { action: 'set', name: '', value: '' }])
  }

  function removeOp(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }

  function updateOp(i: number, field: string, val: string) {
    onChange(value.map((op, idx) => (idx === i ? { ...op, [field]: val } : op)))
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {value.map((op, i) => (
        <div key={i} className="flex items-center gap-2">
          <Select value={op.action} onValueChange={(v) => updateOp(i, 'action', v ?? op.action)} disabled={readOnly}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HEADER_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={op.name}
            onChange={(e) => updateOp(i, 'name', e.target.value)}
            placeholder="Header name"
            className="flex-1"
            disabled={readOnly}
          />
          {op.action !== 'delete' && (
            <Input
              value={op.value ?? ''}
              onChange={(e) => updateOp(i, 'value', e.target.value)}
              placeholder="Value"
              className="flex-1"
              disabled={readOnly}
            />
          )}
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeOp(i)} disabled={readOnly}>
            <TrashIcon className="size-4" />
            <span className="sr-only">Remove</span>
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addOp} disabled={readOnly}>
        <PlusIcon className="size-4" />
        Add
      </Button>
    </div>
  )
}

export function TransformForm({ value, onChange, errors, readOnly }: PolicyFormProps) {
  function set(key: string, val: unknown) {
    onChange({ ...value, [key]: val })
  }

  const pathRewrite = (value.pathRewrite as { stripPrefix?: string; addPrefix?: string }) ?? {}
  const queryOps = (value.queryOperations as QueryOp[]) ?? []

  return (
    <div className="space-y-6">
      <HeaderOpsEditor
        label="Request headers"
        value={(value.requestHeaders as HeaderOp[]) ?? []}
        onChange={(ops) => set('requestHeaders', ops)}
        readOnly={readOnly}
      />

      <HeaderOpsEditor
        label="Response headers"
        value={(value.responseHeaders as HeaderOp[]) ?? []}
        onChange={(ops) => set('responseHeaders', ops)}
        readOnly={readOnly}
      />

      <div className="space-y-2">
        <Label>Path rewrite</Label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="stripPrefix" className="text-xs text-muted-foreground">Strip prefix</Label>
            <Input
              id="stripPrefix"
              value={pathRewrite.stripPrefix ?? ''}
              onChange={(e) => set('pathRewrite', { ...pathRewrite, stripPrefix: e.target.value })}
              placeholder="/api/v1"
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="addPrefix" className="text-xs text-muted-foreground">Add prefix</Label>
            <Input
              id="addPrefix"
              value={pathRewrite.addPrefix ?? ''}
              onChange={(e) => set('pathRewrite', { ...pathRewrite, addPrefix: e.target.value })}
              placeholder="/v2"
              disabled={readOnly}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Query operations</Label>
        {queryOps.map((op, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select
              value={op.action}
              onValueChange={(v) => {
                const updated = queryOps.map((o, idx) => (idx === i ? { ...o, action: v } : o))
                set('queryOperations', updated)
              }}
              disabled={readOnly}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUERY_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={op.key}
              onChange={(e) => {
                const updated = queryOps.map((o, idx) => (idx === i ? { ...o, key: e.target.value } : o))
                set('queryOperations', updated)
              }}
              placeholder="Key"
              className="flex-1"
              disabled={readOnly}
            />
            {op.action !== 'remove' && (
              <Input
                value={op.value ?? ''}
                onChange={(e) => {
                  const updated = queryOps.map((o, idx) => (idx === i ? { ...o, value: e.target.value } : o))
                  set('queryOperations', updated)
                }}
                placeholder="Value"
                className="flex-1"
                disabled={readOnly}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => set('queryOperations', queryOps.filter((_, idx) => idx !== i))}
              disabled={readOnly}
            >
              <TrashIcon className="size-4" />
              <span className="sr-only">Remove</span>
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => set('queryOperations', [...queryOps, { action: 'set', key: '', value: '' }])}
          disabled={readOnly}
        >
          <PlusIcon className="size-4" />
          Add
        </Button>
      </div>
    </div>
  )
}
