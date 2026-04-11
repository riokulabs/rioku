import { cn } from '@/lib/utils'
import { TIME_RANGE_OPTIONS, type TimeRange } from '@/hooks/use-time-range'

interface TimeRangeSelectorProps {
  range: TimeRange
  onChange: (range: TimeRange) => void
  className?: string
}

function TimeRangeSelector({ range, onChange, className }: TimeRangeSelectorProps) {
  return (
    <div className={cn('inline-flex items-center rounded-lg border border-border bg-card', className)}>
      {TIME_RANGE_OPTIONS.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium transition-colors',
            range === opt
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
            opt === '1h' && 'rounded-l-lg',
            opt === '30d' && 'rounded-r-lg',
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

export { TimeRangeSelector }
export type { TimeRangeSelectorProps }
