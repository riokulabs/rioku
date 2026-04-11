import { PlusIcon, TrashIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface KvPair { key: string; value: string }

interface KvEditorProps {
  value: KvPair[]
  onChange: (pairs: KvPair[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}

export function KvEditor({ value, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value' }: KvEditorProps) {
  function addRow() {
    onChange([...value, { key: '', value: '' }])
  }

  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  function updateRow(index: number, field: 'key' | 'value', val: string) {
    const updated = value.map((pair, i) =>
      i === index ? { ...pair, [field]: val } : pair,
    )
    onChange(updated)
  }

  return (
    <div className="space-y-2">
      {value.map((pair, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={pair.key}
            onChange={(e) => updateRow(i, 'key', e.target.value)}
            placeholder={keyPlaceholder}
            className="flex-1"
          />
          <Input
            value={pair.value}
            onChange={(e) => updateRow(i, 'value', e.target.value)}
            placeholder={valuePlaceholder}
            className="flex-1"
          />
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeRow(i)}>
            <TrashIcon className="size-4" />
            <span className="sr-only">Remove row</span>
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <PlusIcon className="size-4" />
        Add
      </Button>
    </div>
  )
}
