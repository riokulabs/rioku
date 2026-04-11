import { useNavigate } from '@tanstack/react-router'
import { ClockIcon, LogOutIcon, RefreshCwIcon } from 'lucide-react'
import { useSessionTimeout } from '@/hooks/use-session-timeout'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function SessionTimeoutDialog() {
  const navigate = useNavigate()
  const { timeRemaining, showWarning, isExpired, extendSession, isExtending } = useSessionTimeout()

  if (isExpired) {
    navigate({ to: '/login' })
    return null
  }

  return (
    <Dialog open={showWarning} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} data-testid="session-timeout-dialog">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ClockIcon className="size-5 text-warning" />
            <DialogTitle>Session Expiring</DialogTitle>
          </div>
          <DialogDescription>
            Your session will expire in{' '}
            <span className="font-mono font-semibold text-foreground" data-testid="session-countdown">
              {formatTime(timeRemaining)}
            </span>
            . Extend your session to continue working.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={extendSession} disabled={isExtending} data-testid="extend-session-btn">
            <RefreshCwIcon className="size-4" />
            {isExtending ? 'Extending...' : 'Extend Session'}
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate({ to: '/login' })}
            data-testid="logout-btn"
          >
            <LogOutIcon className="size-4" />
            Log Out
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { SessionTimeoutDialog }
