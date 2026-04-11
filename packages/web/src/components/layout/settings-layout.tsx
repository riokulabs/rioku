import { Link, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface NavItem {
  labelKey: string
  path: string
  variant?: 'danger'
}

const navItems: NavItem[] = [
  { labelKey: 'nav.general', path: '/settings/general' },
  { labelKey: 'nav.network', path: '/settings/network' },
  { labelKey: 'nav.tls', path: '/settings/tls' },
  { labelKey: 'nav.observability', path: '/settings/observability' },
  { labelKey: 'nav.configStore', path: '/settings/config-store' },
  { labelKey: 'nav.authentication', path: '/settings/authentication' },
  { labelKey: 'nav.pki', path: '/settings/pki' },
  { labelKey: 'nav.dangerZone', path: '/settings/danger-zone', variant: 'danger' },
]

function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('settings')
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      {/* Desktop: vertical side nav */}
      <nav
        className="hidden w-48 shrink-0 md:block"
        aria-label={t('title')}
      >
        <ul className="space-y-1">
          {navItems.map((item) => {
            const active = pathname === item.path
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    'block rounded-md px-3 py-2 text-sm transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                    item.variant === 'danger' && !active && 'text-destructive hover:text-destructive',
                    item.variant === 'danger' && active && 'bg-destructive/10 text-destructive font-medium',
                  )}
                >
                  {t(item.labelKey)}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Mobile: horizontal scrollable nav */}
      <nav
        className="md:hidden -mx-4 overflow-x-auto border-b border-border px-4 pb-2"
        aria-label={t('title')}
      >
        <ul className="flex gap-1 whitespace-nowrap">
          {navItems.map((item) => {
            const active = pathname === item.path
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    'inline-block rounded-md px-3 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                    item.variant === 'danger' && !active && 'text-destructive hover:text-destructive',
                    item.variant === 'danger' && active && 'bg-destructive/10 text-destructive font-medium',
                  )}
                >
                  {t(item.labelKey)}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Content area */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export { SettingsLayout }
