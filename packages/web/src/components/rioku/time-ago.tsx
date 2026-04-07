import { useMemo } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface TimeAgoProps {
  date: string | Date
  className?: string
}

function TimeAgo({ date, className }: TimeAgoProps) {
  const dateObj = useMemo(
    () => (date instanceof Date ? date : new Date(date)),
    [date],
  )

  const relative = useMemo(
    () => formatDistanceToNow(dateObj, { addSuffix: true }),
    [dateObj],
  )

  const absolute = useMemo(
    () => format(dateObj, 'PPpp'),
    [dateObj],
  )

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          'cursor-default text-sm text-muted-foreground',
          className,
        )}
      >
        {relative}
      </TooltipTrigger>
      <TooltipContent>{absolute}</TooltipContent>
    </Tooltip>
  )
}

export { TimeAgo }
export type { TimeAgoProps }
