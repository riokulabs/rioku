import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, userEvent } from '@/test/utils'
import { NotificationBell, type Notification, formatRelativeTime } from '../notification-bell'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
    i18n: { language: 'en' },
  }),
}))

// Use a variable to track popover open state for testing
let popoverOpen = false

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => {
    return <div data-testid="popover-root">{children}</div>
  },
  PopoverContent: ({ children }: { children: React.ReactNode }) => {
    // Only render content when "open"
    return popoverOpen ? <div data-testid="popover-content">{children}</div> : null
  },
  PopoverTrigger: ({
    children,
    render: renderProp,
  }: {
    children: React.ReactNode
    render?: React.ReactElement
  }) => {
    if (renderProp) {
      // Wrap the render element and add onClick to toggle popover
      return (
        <div
          onClick={() => {
            popoverOpen = !popoverOpen
          }}
        >
          {renderProp}
          {children}
        </div>
      )
    }
    return <div>{children}</div>
  },
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
}))

function createNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '1',
    type: 'info',
    title: 'Test Notification',
    message: 'This is a test notification message',
    timestamp: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
    read: false,
    ...overrides,
  }
}

describe('NotificationBell', () => {
  const mockOnMarkAllRead = vi.fn()
  const mockOnMarkRead = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    popoverOpen = false
  })

  it('renders bell icon', () => {
    render(
      <NotificationBell
        notifications={[]}
        onMarkAllRead={mockOnMarkAllRead}
        onMarkRead={mockOnMarkRead}
      />,
    )

    expect(screen.getByLabelText('Notifications')).toBeInTheDocument()
  })

  it('shows unread count badge when there are unread notifications', () => {
    const notifications = [
      createNotification({ id: '1', read: false }),
      createNotification({ id: '2', read: false }),
      createNotification({ id: '3', read: true }),
    ]

    render(
      <NotificationBell
        notifications={notifications}
        onMarkAllRead={mockOnMarkAllRead}
        onMarkRead={mockOnMarkRead}
      />,
    )

    const badge = screen.getByTestId('unread-badge')
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toBe('2')
  })

  it('hides unread badge when all notifications are read', () => {
    const notifications = [
      createNotification({ id: '1', read: true }),
    ]

    render(
      <NotificationBell
        notifications={notifications}
        onMarkAllRead={mockOnMarkAllRead}
        onMarkRead={mockOnMarkRead}
      />,
    )

    expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument()
  })

  it('clicking bell opens notification panel', async () => {
    const user = userEvent.setup()
    const notifications = [createNotification()]

    const { rerender } = render(
      <NotificationBell
        notifications={notifications}
        onMarkAllRead={mockOnMarkAllRead}
        onMarkRead={mockOnMarkRead}
      />,
    )

    const bellButton = screen.getByLabelText('Notifications')
    await user.click(bellButton)

    // Rerender to see the popover state change
    rerender(
      <NotificationBell
        notifications={notifications}
        onMarkAllRead={mockOnMarkAllRead}
        onMarkRead={mockOnMarkRead}
      />,
    )

    expect(screen.getByTestId('popover-content')).toBeInTheDocument()
    expect(screen.getByText('Test Notification')).toBeInTheDocument()
  })

  it('shows "Mark all as read" button when there are unread notifications', async () => {
    popoverOpen = true
    const notifications = [createNotification({ read: false })]

    render(
      <NotificationBell
        notifications={notifications}
        onMarkAllRead={mockOnMarkAllRead}
        onMarkRead={mockOnMarkRead}
      />,
    )

    expect(screen.getByText('Mark all as read')).toBeInTheDocument()
  })

  it('calls onMarkAllRead when "Mark all as read" is clicked', async () => {
    popoverOpen = true
    const user = userEvent.setup()
    const notifications = [createNotification({ read: false })]

    render(
      <NotificationBell
        notifications={notifications}
        onMarkAllRead={mockOnMarkAllRead}
        onMarkRead={mockOnMarkRead}
      />,
    )

    const markAllButton = screen.getByText('Mark all as read')
    await user.click(markAllButton)

    expect(mockOnMarkAllRead).toHaveBeenCalledOnce()
  })

  it('calls onMarkRead when a notification is clicked', async () => {
    popoverOpen = true
    const user = userEvent.setup()
    const notifications = [createNotification({ id: 'notif-42' })]

    render(
      <NotificationBell
        notifications={notifications}
        onMarkAllRead={mockOnMarkAllRead}
        onMarkRead={mockOnMarkRead}
      />,
    )

    const notificationItem = screen.getByText('Test Notification').closest('button')!
    await user.click(notificationItem)

    expect(mockOnMarkRead).toHaveBeenCalledWith('notif-42')
  })

  it('displays notifications with colored left border by type', () => {
    popoverOpen = true
    const notifications = [
      createNotification({ id: '1', type: 'warning', title: 'Warning notification' }),
      createNotification({ id: '2', type: 'error', title: 'Error notification' }),
      createNotification({ id: '3', type: 'success', title: 'Success notification' }),
      createNotification({ id: '4', type: 'info', title: 'Info notification' }),
    ]

    render(
      <NotificationBell
        notifications={notifications}
        onMarkAllRead={mockOnMarkAllRead}
        onMarkRead={mockOnMarkRead}
      />,
    )

    const warningItem = screen.getByText('Warning notification').closest('button')!
    const errorItem = screen.getByText('Error notification').closest('button')!
    const successItem = screen.getByText('Success notification').closest('button')!
    const infoItem = screen.getByText('Info notification').closest('button')!

    expect(warningItem.className).toContain('border-l-amber-500')
    expect(errorItem.className).toContain('border-l-red-500')
    expect(successItem.className).toContain('border-l-green-500')
    expect(infoItem.className).toContain('border-l-blue-500')
  })

  it('highlights unread notifications with bg-muted', () => {
    popoverOpen = true
    const notifications = [
      createNotification({ id: '1', read: false, title: 'Unread' }),
      createNotification({ id: '2', read: true, title: 'Read' }),
    ]

    render(
      <NotificationBell
        notifications={notifications}
        onMarkAllRead={mockOnMarkAllRead}
        onMarkRead={mockOnMarkRead}
      />,
    )

    const unreadItem = screen.getByText('Unread').closest('button')!
    const readItem = screen.getByText('Read').closest('button')!

    expect(unreadItem.className).toContain('bg-muted/50')
    expect(readItem.className).not.toContain('bg-muted/50')
  })

  it('shows empty state when no notifications', () => {
    popoverOpen = true

    render(
      <NotificationBell
        notifications={[]}
        onMarkAllRead={mockOnMarkAllRead}
        onMarkRead={mockOnMarkRead}
      />,
    )

    expect(screen.getByText('No notifications')).toBeInTheDocument()
  })

  it('caps badge display at 99+', () => {
    const notifications = Array.from({ length: 100 }, (_, i) =>
      createNotification({ id: String(i), read: false }),
    )

    render(
      <NotificationBell
        notifications={notifications}
        onMarkAllRead={mockOnMarkAllRead}
        onMarkRead={mockOnMarkRead}
      />,
    )

    const badge = screen.getByTestId('unread-badge')
    expect(badge.textContent).toBe('99+')
  })
})

describe('formatRelativeTime', () => {
  it('returns "just now" for recent timestamps', () => {
    const now = new Date()
    expect(formatRelativeTime(now)).toBe('just now')
  })

  it('returns minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
    expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago')
  })

  it('returns hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago')
  })

  it('returns days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago')
  })
})
