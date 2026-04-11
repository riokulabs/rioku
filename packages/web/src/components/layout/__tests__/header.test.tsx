import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/utils'

// Mock dependencies before importing the component
vi.mock('@tanstack/react-router', () => ({
  useRouterState: vi.fn(() => ({
    location: { pathname: '/services/api-gateway' },
  })),
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; [k: string]: unknown }) => (
    <a href={to} {...props}>{children}</a>
  ),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/hooks/use-theme', () => ({
  useTheme: vi.fn(() => ({
    resolvedTheme: 'dark',
    setTheme: vi.fn(),
  })),
}))

vi.mock('@/hooks/use-hotkeys', () => ({
  getModLabel: () => 'Ctrl',
}))

const mockSetOpenMobile = vi.fn()
let mockIsMobile = false

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mockIsMobile,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: ({ className }: { className?: string }) => (
    <button data-testid="sidebar-trigger" className={className}>Trigger</button>
  ),
  useSidebar: () => ({
    setOpenMobile: mockSetOpenMobile,
  }),
}))

vi.mock('@/components/ui/separator', () => ({
  Separator: () => <div data-testid="separator" />,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, render }: { children: React.ReactNode; render?: React.ReactElement }) => {
    if (render) {
      // Clone the render element and add children
      return <div data-testid="tooltip-trigger">{render}{children}</div>
    }
    return <div data-testid="tooltip-trigger">{children}</div>
  },
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children, render }: { children: React.ReactNode; render?: React.ReactElement }) => {
    if (render) return <div>{render}{children}</div>
    return <div>{children}</div>
  },
}))

vi.mock('@/components/plugin/slot', () => ({
  Slot: ({ zone }: { zone: string }) => <div data-testid={`slot-${zone}`} />,
}))

import { Header } from '../header'

describe('Header', () => {
  const mockOnOpenCommandPalette = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMobile = false
  })

  it('renders breadcrumbs with chevron separators', () => {
    render(<Header onOpenCommandPalette={mockOnOpenCommandPalette} />)

    const chevrons = screen.getAllByTestId('breadcrumb-chevron')
    expect(chevrons).toHaveLength(1) // One chevron between "Services" and "Api-gateway"
  })

  it('does not render slash separators in breadcrumbs', () => {
    render(<Header onOpenCommandPalette={mockOnOpenCommandPalette} />)

    const breadcrumbNav = screen.getByLabelText('Breadcrumb')
    expect(breadcrumbNav.textContent).not.toContain('/')
  })

  it('renders last breadcrumb as bold and non-clickable', () => {
    render(<Header onOpenCommandPalette={mockOnOpenCommandPalette} />)

    // Last segment "Api-gateway" should be a span (not a link), with font-semibold
    const lastSegment = screen.getByText('Api-gateway')
    expect(lastSegment.tagName).toBe('SPAN')
    expect(lastSegment.className).toContain('font-semibold')
  })

  it('renders non-last breadcrumbs as clickable links', () => {
    render(<Header onOpenCommandPalette={mockOnOpenCommandPalette} />)

    const link = screen.getByText('Services')
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/services')
  })

  it('renders search trigger', () => {
    render(<Header onOpenCommandPalette={mockOnOpenCommandPalette} />)

    expect(screen.getByText('Search')).toBeInTheDocument()
  })

  it('renders theme toggle', () => {
    render(<Header onOpenCommandPalette={mockOnOpenCommandPalette} />)

    // sr-only text + tooltip content both contain "Toggle theme"
    const toggleTexts = screen.getAllByText('Toggle theme')
    expect(toggleTexts.length).toBeGreaterThanOrEqual(1)
  })

  it('renders notification bell', () => {
    render(<Header onOpenCommandPalette={mockOnOpenCommandPalette} />)

    expect(screen.getByLabelText('Notifications')).toBeInTheDocument()
  })

  it('shows mobile hamburger when on mobile', () => {
    mockIsMobile = true
    render(<Header onOpenCommandPalette={mockOnOpenCommandPalette} />)

    const hamburger = screen.getByTestId('mobile-hamburger')
    expect(hamburger).toBeInTheDocument()
  })

  it('hides mobile hamburger on desktop', () => {
    mockIsMobile = false
    render(<Header onOpenCommandPalette={mockOnOpenCommandPalette} />)

    expect(screen.queryByTestId('mobile-hamburger')).not.toBeInTheDocument()
  })

  it('calls setOpenMobile when hamburger is clicked', async () => {
    mockIsMobile = true
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()

    render(<Header onOpenCommandPalette={mockOnOpenCommandPalette} />)

    const hamburger = screen.getByTestId('mobile-hamburger')
    await user.click(hamburger)

    expect(mockSetOpenMobile).toHaveBeenCalledWith(true)
  })

  it('hides SidebarTrigger on mobile', () => {
    mockIsMobile = true
    render(<Header onOpenCommandPalette={mockOnOpenCommandPalette} />)

    const sidebarTrigger = screen.getByTestId('sidebar-trigger')
    expect(sidebarTrigger.className).toContain('hidden')
  })
})
