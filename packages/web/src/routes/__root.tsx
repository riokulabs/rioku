import { useState, useCallback } from 'react'
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import { SidebarProvider, SidebarInset, useSidebar } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { Header } from '@/components/layout/header'
import { CommandPalette } from '@/components/layout/command-palette'
import { KeyboardShortcutHelp } from '@/components/layout/keyboard-shortcut-help'
import { ProtectedRoute } from '@/components/auth/protected-route'
import { useHotkey } from '@/hooks/use-hotkeys'
import { useTheme } from '@/hooks/use-theme'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const routerState = useRouterState()
  const isLoginRoute = routerState.location.pathname === '/login'

  // Login page renders without the app shell
  if (isLoginRoute) {
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
        <ProtectedRoute>
          <AppShell />
        </ProtectedRoute>
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
  const toggleShortcutHelp = useCallback(() => setShortcutHelpOpen((prev) => !prev), [])
  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setTheme])

  // Global hotkeys
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
      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
      <KeyboardShortcutHelp open={shortcutHelpOpen} onOpenChange={setShortcutHelpOpen} />
    </>
  )
}
