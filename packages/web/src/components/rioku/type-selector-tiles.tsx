import { cn } from '@/lib/utils'

interface TileOption {
  value: string
  label: string
  description: string
  icon: React.ReactNode
}

interface TypeSelectorTilesProps {
  options: TileOption[]
  value: string | null
  onChange: (value: string) => void
}

export function TypeSelectorTiles({ options, value, onChange }: TypeSelectorTilesProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          aria-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors',
            'hover:border-primary/50 hover:bg-accent',
            value === opt.value && 'border-primary bg-primary/5',
          )}
        >
          <span className="text-muted-foreground">{opt.icon}</span>
          <span className="text-sm font-medium">{opt.label}</span>
          <span className="text-xs text-muted-foreground">{opt.description}</span>
        </button>
      ))}
    </div>
  )
}
