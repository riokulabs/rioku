import { useState, useCallback } from 'react'
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { SidebarProvider, SidebarInset, useSidebar } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { Header } from '@/components/layout/header'
import { CommandPalette } from '@/components/layout/command-palette'
import { KeyboardShortcutHelp } from '@/components/layout/keyboard-shortcut-help'
import { useHotkey } from '@/hooks/use-hotkeys'
import { useTheme } from '@/hooks/use-theme'
import type { MeResponse } from '@/lib/api'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ location }) => {
    const unguarded = ['/login', '/change-password']
    if (unguarded.includes(location.pathname)) return

    const res = await fetch('/api/v1/auth/me', { credentials: 'include' })
    if (!res.ok) {
      throw redirect({ to: '/login' })
    }
    const data: MeResponse = await res.json()
    if (
      data.user.force_password_change &&
      location.pathname !== '/change-password'
    ) {
      throw redirect({ to: '/change-password' })
    }
    return { session: data }
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
        <div className="flex-1 overflow-auto p-4">
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
    </>
  )
}
