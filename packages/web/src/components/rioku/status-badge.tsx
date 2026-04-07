import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

type Status = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'

interface StatusBadgeProps {
  status: Status
  label?: string
}

const statusConfig: Record<Status, { dot: string; bg: string; text: string; defaultLabel: string }> = {
  healthy: {
    dot: 'bg-green-500',
    bg: 'bg-green-500/10 dark:bg-green-500/20',
    text: 'text-green-700 dark:text-green-400',
    defaultLabel: 'Healthy',
  },
  degraded: {
    dot: 'bg-yellow-500',
    bg: 'bg-yellow-500/10 dark:bg-yellow-500/20',
    text: 'text-yellow-700 dark:text-yellow-400',
    defaultLabel: 'Degraded',
  },
  unhealthy: {
    dot: 'bg-red-500',
    bg: 'bg-red-500/10 dark:bg-red-500/20',
    text: 'text-red-700 dark:text-red-400',
    defaultLabel: 'Unhealthy',
  },
  unknown: {
    dot: 'bg-gray-400',
    bg: 'bg-gray-500/10 dark:bg-gray-500/20',
    text: 'text-gray-700 dark:text-gray-400',
    defaultLabel: 'Unknown',
  },
}

function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 border-transparent', config.bg, config.text)}
    >
      <span
        className={cn('size-1.5 rounded-full animate-pulse', config.dot)}
        aria-hidden="true"
      />
      {label ?? config.defaultLabel}
    </Badge>
  )
}

export { StatusBadge }
export type { StatusBadgeProps, Status }
