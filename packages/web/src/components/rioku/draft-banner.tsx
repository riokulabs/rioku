import { FileTextIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'

interface DraftBannerProps {
  draftTimestamp: number | null
  onRestore: () => void
  onDiscard: () => void
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days !== 1 ? 's' : ''} ago`
}

function DraftBanner({ draftTimestamp, onRestore, onDiscard }: DraftBannerProps) {
  return (
    <Alert data-testid="draft-banner" className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <FileTextIcon className="size-4" />
        <span className="text-sm">
          You have an unsaved draft from{' '}
          <span className="font-medium">
            {draftTimestamp ? formatTimeAgo(draftTimestamp) : 'earlier'}
          </span>.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onRestore} data-testid="restore-draft-btn">
          Restore
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          data-testid="discard-draft-btn"
        >
          Discard
        </Button>
      </div>
    </Alert>
  )
}

export { DraftBanner }
