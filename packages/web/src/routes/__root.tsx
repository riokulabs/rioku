import { useState, useCallback } from 'react'
import {
  createRootRouteWithContext,
  ErrorComponent,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { SidebarProvider, SidebarInset, useSidebar } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { Header } from '@/components/layout/header'
import { CommandPalette } from '@/components/layout/command-palette'
import { KeyboardShortcutHelp } from '@/components/layout/keyboard-shortcut-help'
import { ConnectionIndicator } from '@/components/rioku/connection-indicator'
import { SessionTimeoutDialog } from '@/components/layout/session-timeout-dialog'
import { useHotkey } from '@/hooks/use-hotkeys'
import { useTheme } from '@/hooks/use-theme'
import { useFocusOnNavigate } from '@/hooks/use-focus-on-navigate'
import type { MeResponse } from '@/lib/api'

interface RouterContext {
  queryClient: QueryClient
}

function RootErrorComponent({ error, reset }: ErrorComponentProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : 'An unexpected error occurred'}
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.assign('/')}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            Go to dashboard
          </button>
        </div>
      </div>
    </div>
  )
}

/** Exported for testing — used as notFoundComponent on the root route. */
export function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="text-6xl font-bold text-muted-foreground/30">404</div>
      <h1 className="text-xl font-semibold text-foreground">Page not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Button variant="outline" render={<Link to="/" />}>
        Go to Dashboard
      </Button>
    </div>
  )
}

export const Route = createRootRouteWithContext<RouterContext>()({
  errorComponent: RootErrorComponent,
  notFoundComponent: NotFound,
  beforeLoad: async ({ location }) => {
    const unguarded = ['/login', '/change-password']
    if (unguarded.includes(location.pathname)) return

    // In mock mode, bypass real auth and use mock session data
    if (sessionStorage.getItem('rioku-mock-session')) {
      const { mockMe } = await import('@/mocks/data/users')
      return { session: mockMe }
    }

    try {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' })
      if (!res.ok) {
        throw redirect({ to: '/login' })
      }
      const data: MeResponse = await res.json()
      if (
        data.user.forcePasswordChange &&
        location.pathname !== '/change-password'
      ) {
        throw redirect({ to: '/change-password' })
      }
      return { session: data }
    } catch (e) {
      if (e && typeof e === 'object' && 'to' in e) throw e
      throw redirect({ to: '/login' })
    }
  },
  component: RootLayout,
})

function RootLayout() {
  const routerState = useRouterState()
  const isLoginRoute = routerState.location.pathname === '/login'
  const isChangePasswordRoute =
    routerState.location.pathname === '/change-password'

  if (isLoginRoute || isChangePasswordRoute) {
    return (
      <>
        <Outlet />
        <Toaster position="bottom-right" richColors />
      </>
    )
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:text-sm focus:font-medium"
        >
          Skip to main content
        </a>
        <AppShell />
        <Toaster position="bottom-right" richColors />
      </SidebarProvider>
    </TooltipProvider>
  )
}

function AppShell() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const { toggleSidebar } = useSidebar()
  const { resolvedTheme, setTheme } = useTheme()
  useFocusOnNavigate()

  const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), [])
  const toggleShortcutHelp = useCallback(
    () => setShortcutHelpOpen((prev) => !prev),
    [],
  )
  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setTheme])

  useHotkey('Mod+b', toggleSidebar, { scope: 'global' })
  useHotkey('Mod+k', openCommandPalette, { scope: 'global' })
  useHotkey('?', toggleShortcutHelp, { scope: 'global' })
  useHotkey('Mod+Shift+t', toggleTheme, { scope: 'global' })

  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <Header onOpenCommandPalette={openCommandPalette} />
        <ConnectionIndicator />
        <div id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 min-h-0">
          <Outlet />
        </div>
      </SidebarInset>
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      />
      <KeyboardShortcutHelp
        open={shortcutHelpOpen}
        onOpenChange={setShortcutHelpOpen}
      />
      <SessionTimeoutDialog />
    </>
  )
}
