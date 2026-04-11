import { useState, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const UNITS = [
  { value: 'ms', label: 'ms' },
  { value: 's', label: 'sec' },
  { value: 'm', label: 'min' },
  { value: 'h', label: 'hr' },
] as const

type DurationUnit = typeof UNITS[number]['value']

interface DurationInputProps {
  value: string
  onChange: (value: string) => void
  id?: string
  placeholder?: string
}

function parseDuration(raw: string): { num: number; unit: DurationUnit } {
  const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/)
  if (!match) return { num: 0, unit: 's' }
  return { num: parseFloat(match[1]), unit: match[2] as DurationUnit }
}

export function DurationInput({ value, onChange, id, placeholder }: DurationInputProps) {
  const parsed = parseDuration(value)
  const [num, setNum] = useState(parsed.num)
  const [unit, setUnit] = useState<DurationUnit>(parsed.unit)

  const emit = useCallback((n: number, u: DurationUnit) => {
    onChange(`${n}${u}`)
  }, [onChange])

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        min={0}
        value={num}
        onChange={(e) => {
          const n = parseFloat(e.target.value) || 0
          setNum(n)
          emit(n, unit)
        }}
        placeholder={placeholder}
        className="w-24"
      />
      <Select value={unit} onValueChange={(v) => { setUnit(v as DurationUnit); emit(num, v as DurationUnit) }}>
        <SelectTrigger className="w-20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNITS.map((u) => (
            <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
