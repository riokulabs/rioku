import { Bell, AlertTriangle, AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface Notification {
  id: string
  type: 'warning' | 'error' | 'success' | 'info'
  title: string
  message: string
  timestamp: Date
  read: boolean
}

export interface NotificationBellProps {
  notifications: Notification[]
  onMarkAllRead: () => void
  onMarkRead: (id: string) => void
}

const BORDER_COLORS: Record<Notification['type'], string> = {
  warning: 'border-l-amber-500',
  error: 'border-l-red-500',
  success: 'border-l-green-500',
  info: 'border-l-blue-500',
}

const TYPE_ICONS: Record<Notification['type'], typeof AlertTriangle> = {
  warning: AlertTriangle,
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
}

const ICON_COLORS: Record<Notification['type'], string> = {
  warning: 'text-amber-500',
  error: 'text-red-500',
  success: 'text-green-500',
  info: 'text-blue-500',
}

function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function NotificationBell({ notifications, onMarkAllRead, onMarkRead }: NotificationBellProps) {
  const { t } = useTranslation()
  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            aria-label={t('notifications.bell', 'Notifications')}
          />
        }
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span
            data-testid="unread-badge"
            className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">
            {t('notifications.title', 'Notifications')}
          </span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-1 text-xs"
              onClick={onMarkAllRead}
            >
              {t('notifications.markAllRead', 'Mark all as read')}
            </Button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('notifications.empty', 'No notifications')}
            </div>
          ) : (
            notifications.map((notification) => {
              const Icon = TYPE_ICONS[notification.type]
              return (
                <button
                  key={notification.id}
                  type="button"
                  className={cn(
                    'flex w-full gap-2.5 border-l-2 px-3 py-2.5 text-left transition-colors hover:bg-accent/50',
                    BORDER_COLORS[notification.type],
                    !notification.read && 'bg-muted/50',
                  )}
                  onClick={() => onMarkRead(notification.id)}
                >
                  <Icon className={cn('mt-0.5 size-4 shrink-0', ICON_COLORS[notification.type])} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">{notification.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(notification.timestamp)}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {notification.message}
                    </p>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { NotificationBell, formatRelativeTime }
