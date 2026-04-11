import { cn } from '@/lib/utils'

interface ProgressBarProps {
  value: number
  max: number
  label: string
  formatValue?: (value: number) => string
  warningThreshold?: number
  dangerThreshold?: number
  className?: string
}

function ProgressBar({
  value,
  max,
  label,
  formatValue,
  warningThreshold = 80,
  dangerThreshold = 95,
  className,
}: ProgressBarProps) {
  const percentage = max > 0 ? Math.round((value / max) * 100) : 0
  const normalizedPercentage = Math.min(percentage, 100)

  const fillColor =
    percentage >= dangerThreshold
      ? 'bg-red-500'
      : percentage >= warningThreshold
        ? 'bg-amber-500'
        : 'bg-primary'

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{percentage}%</span>
      </div>
      <div
        className="h-2.5 w-full rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div
          data-slot="progress-fill"
          className={cn('h-full rounded-full transition-all duration-300', fillColor)}
          style={{ width: `${normalizedPercentage}%` }}
        />
      </div>
      {formatValue && (
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-muted-foreground">
            {formatValue(value)}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatValue(max)}
          </span>
        </div>
      )}
    </div>
  )
}

export { ProgressBar }
export type { ProgressBarProps }
