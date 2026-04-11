import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock all dependencies that __root.tsx imports to avoid deep resolution chains
vi.mock('@tanstack/react-router', () => ({
  createRootRouteWithContext: () => () => ({ component: null }),
  ErrorComponent: () => null,
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; [k: string]: unknown }) => (
    <a href={to} {...props}>{children}</a>
  ),
  Outlet: () => null,
  redirect: vi.fn(),
  useRouterState: vi.fn(() => ({ location: { pathname: '/' } })),
}))

vi.mock('sonner', () => ({
  Toaster: () => null,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSidebar: () => ({ toggleSidebar: vi.fn() }),
}))

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'> & { render?: React.ReactElement }) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@/components/layout/app-sidebar', () => ({
  AppSidebar: () => null,
}))

vi.mock('@/components/layout/header', () => ({
  Header: () => null,
}))

vi.mock('@/components/layout/command-palette', () => ({
  CommandPalette: () => null,
}))

vi.mock('@/components/layout/keyboard-shortcut-help', () => ({
  KeyboardShortcutHelp: () => null,
}))

vi.mock('@/components/rioku/connection-indicator', () => ({
  ConnectionIndicator: () => null,
}))

vi.mock('@/hooks/use-hotkeys', () => ({
  useHotkey: vi.fn(),
}))

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', setTheme: vi.fn() }),
}))

vi.mock('@/hooks/use-focus-on-navigate', () => ({
  useFocusOnNavigate: vi.fn(),
}))

import { NotFound } from '../__root'

describe('NotFound (404 page)', () => {
  it('renders the 404 heading', () => {
    render(<NotFound />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found')
  })

  it('renders the 404 number', () => {
    render(<NotFound />)

    expect(screen.getByText('404')).toBeInTheDocument()
  })

  it('renders the description message', () => {
    render(<NotFound />)

    expect(
      screen.getByText(/doesn't exist or has been moved/),
    ).toBeInTheDocument()
  })

  it('renders a dashboard link', () => {
    render(<NotFound />)

    const link = screen.getByText('Go to Dashboard')
    expect(link).toBeInTheDocument()
  })
})
