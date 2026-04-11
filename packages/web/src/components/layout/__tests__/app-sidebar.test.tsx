import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SidebarProvider } from '@/components/ui/sidebar'

// ---------------------------------------------------------------------------
// Mock TanStack Router
// ---------------------------------------------------------------------------
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: () => ({
    location: { pathname: '/' },
  }),
}))

// ---------------------------------------------------------------------------
// Mock auth hooks — default: authenticated admin
// ---------------------------------------------------------------------------
vi.mock('@/hooks/use-auth', () => ({
  useCurrentUser: () => ({ username: 'admin', displayName: 'Admin User', permissions: ['*'] }),
  useHasPermission: () => true,
}))

// ---------------------------------------------------------------------------
// Mock plugin slot (no-op)
// ---------------------------------------------------------------------------
vi.mock('@/components/plugin/slot', () => ({
  Slot: () => null,
}))

// ---------------------------------------------------------------------------
// Mock i18next — look up from real common.json so text matches production
// ---------------------------------------------------------------------------
import commonTranslations from '@/locales/en/common.json'

function lookupTranslation(key: string, fallback?: string): string {
  // key is like "nav.dashboard" — walk the common translations object
  const parts = key.split('.')
  let current: unknown = commonTranslations
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return fallback ?? key
    }
  }
  return typeof current === 'string' ? current : (fallback ?? key)
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => lookupTranslation(key, fallback),
    i18n: { language: 'en' },
  }),
}))

// ---------------------------------------------------------------------------
// Mock popover — render children inline so tests can query them
// ---------------------------------------------------------------------------
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) => (
    <button type="button" {...props}>{children}</button>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// ---------------------------------------------------------------------------
// Mock mobile hook so SidebarProvider doesn't use mobile sheet
// ---------------------------------------------------------------------------
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}))

import { AppSidebar } from '../app-sidebar'

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider defaultOpen>
        <AppSidebar />
      </SidebarProvider>
    </QueryClientProvider>,
  )
}

describe('AppSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all nav section headings', () => {
    renderSidebar()

    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByText('Configuration')).toBeInTheDocument()
    expect(screen.getByText('Traffic')).toBeInTheDocument()
    expect(screen.getByText('Infrastructure')).toBeInTheDocument()
    expect(screen.getByText('Security')).toBeInTheDocument()
  })

  it('does NOT show Settings as a main nav item', () => {
    renderSidebar()

    // Settings should only appear inside the user popup, not as a sidebar nav item.
    // There may be a "Settings" text in the popup, but there should be no SidebarMenuButton
    // for Settings. We verify by checking that there is no link to /settings in the main
    // sidebar content (nav sections).
    const allLinks = screen.getAllByRole('link')
    const settingsNavLinks = allLinks.filter(
      (link) => link.getAttribute('href') === '/settings' && link.closest('[data-sidebar="content"]'),
    )
    expect(settingsNavLinks).toHaveLength(0)
  })

  it('renders new nav items: Certificates, API Keys, Access Policies, Audit Log', () => {
    renderSidebar()

    expect(screen.getByText('Certificates')).toBeInTheDocument()
    expect(screen.getByText('API Keys')).toBeInTheDocument()
    expect(screen.getByText('Access Policies')).toBeInTheDocument()
    expect(screen.getByText('Audit Log')).toBeInTheDocument()
  })

  it('renders Users & Roles nav item under Security', () => {
    renderSidebar()

    expect(screen.getByText('Users & Roles')).toBeInTheDocument()
  })

  it('renders the user menu trigger button in the footer', () => {
    renderSidebar()

    const trigger = screen.getByTestId('user-menu-trigger')
    expect(trigger).toBeInTheDocument()
    // Should display the user name when expanded
    expect(screen.getByText('Admin User')).toBeInTheDocument()
  })

  it('user popup contains Profile, Settings, and Log out', () => {
    renderSidebar()

    // Because PopoverContent is mocked to render inline, all items are visible
    expect(screen.getByText('Profile')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Log out')).toBeInTheDocument()
  })

  it('renders Dashboard nav item', () => {
    renderSidebar()

    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('renders existing nav items unchanged', () => {
    renderSidebar()

    expect(screen.getByText('Routes')).toBeInTheDocument()
    expect(screen.getByText('Services')).toBeInTheDocument()
    expect(screen.getByText('Policies')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText('Analytics')).toBeInTheDocument()
    expect(screen.getByText('AI Workloads')).toBeInTheDocument()
    expect(screen.getByText('Cluster')).toBeInTheDocument()
    expect(screen.getByText('Plugins')).toBeInTheDocument()
  })
})
