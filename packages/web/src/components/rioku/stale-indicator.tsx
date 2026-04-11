import { RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TimeAgo } from '@/components/rioku/time-ago'

interface StaleIndicatorProps {
  dataUpdatedAt: number | string
  onRefresh?: () => void
}

function StaleIndicator({ dataUpdatedAt, onRefresh }: StaleIndicatorProps) {
  const dateStr = typeof dataUpdatedAt === 'number'
    ? new Date(dataUpdatedAt).toISOString()
    : dataUpdatedAt

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="stale-indicator">
      <span>
        Last updated <TimeAgo date={dateStr} />
      </span>
      {onRefresh && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRefresh}
          data-testid="refresh-button"
        >
          <RefreshCwIcon className="size-3" />
          <span className="sr-only">Refresh</span>
        </Button>
      )}
    </div>
  )
}

export { StaleIndicator }
