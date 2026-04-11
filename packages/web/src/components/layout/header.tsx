import { Link, useRouterState } from '@tanstack/react-router'
import { ChevronRight, Menu, Search, Sun, Moon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Slot } from '@/components/plugin/slot'
import { useTheme } from '@/hooks/use-theme'
import { useIsMobile } from '@/hooks/use-mobile'
import { getModLabel } from '@/hooks/use-hotkeys'
import { NotificationBell, type Notification } from '@/components/layout/notification-bell'

/** Derive breadcrumb segments from the current route pathname. */
function useBreadcrumbs(): { label: string; path: string }[] {
  const routerState = useRouterState()
  const pathname = routerState.location.pathname

  if (pathname === '/') {
    return [{ label: 'Dashboard', path: '/' }]
  }

  const segments = pathname.split('/').filter(Boolean)
  return segments.map((seg, i) => ({
    label: seg.charAt(0).toUpperCase() + seg.slice(1),
    path: '/' + segments.slice(0, i + 1).join('/'),
  }))
}

interface HeaderProps {
  onOpenCommandPalette: () => void
}

function Header({ onOpenCommandPalette }: HeaderProps) {
  const { t } = useTranslation()
  const { resolvedTheme, setTheme } = useTheme()
  const breadcrumbs = useBreadcrumbs()
  const modLabel = getModLabel()
  const isMobile = useIsMobile()
  const { setOpenMobile } = useSidebar()

  // Notification state — empty for now, SSE wiring is a later phase
  const notifications: Notification[] = []

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      {/* Mobile hamburger */}
      {isMobile && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="-ml-1"
          onClick={() => setOpenMobile(true)}
          aria-label="Open menu"
          data-testid="mobile-hamburger"
        >
          <Menu className="size-4" />
        </Button>
      )}

      {/* Desktop sidebar trigger — hidden on mobile */}
      <SidebarTrigger className={isMobile ? 'hidden' : '-ml-1'} />
      <Separator orientation="vertical" className="mr-2 !h-4" />

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight
                className="size-3.5 text-muted-foreground/50"
                aria-hidden="true"
                data-testid="breadcrumb-chevron"
              />
            )}
            {i === breadcrumbs.length - 1 ? (
              <span className="font-semibold text-foreground">{crumb.label}</span>
            ) : (
              <Link to={crumb.path} className="hover:text-foreground transition-colors">
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search trigger */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-muted-foreground"
              onClick={onOpenCommandPalette}
            />
          }
        >
          <Search className="size-3.5" />
          <span className="hidden sm:inline">{t('actions.search', 'Search')}</span>
          <kbd className="pointer-events-none hidden h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
            {modLabel}+K
          </kbd>
        </TooltipTrigger>
        <TooltipContent>{t('actions.search', 'Search')} ({modLabel}+K)</TooltipContent>
      </Tooltip>

      {/* Notification bell */}
      <NotificationBell
        notifications={notifications}
        onMarkAllRead={() => {}}
        onMarkRead={() => {}}
      />

      {/* Theme toggle */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleTheme}
            />
          }
        >
          {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          <span className="sr-only">Toggle theme</span>
        </TooltipTrigger>
        <TooltipContent>Toggle theme</TooltipContent>
      </Tooltip>

      {/* Plugin injection zone */}
      <Slot zone="header.actions" />
    </header>
  )
}

export { Header }
