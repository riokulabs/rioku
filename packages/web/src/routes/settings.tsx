import { createFileRoute, Outlet, Link, redirect, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  SettingsIcon,
  NetworkIcon,
  ShieldIcon,
  LockIcon,
  DatabaseIcon,
  EyeIcon,
  KeyIcon,
  AlertTriangleIcon,
} from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { Slot } from '@/components/plugin/slot'
import { cn } from '@/lib/utils'

const settingsNavItems = [
  { path: '/settings/general', i18nKey: 'nav.general', icon: SettingsIcon },
  { path: '/settings/network', i18nKey: 'nav.network', icon: NetworkIcon },
  { path: '/settings/tls', i18nKey: 'nav.tls', icon: ShieldIcon },
  { path: '/settings/observability', i18nKey: 'nav.observability', icon: EyeIcon },
  { path: '/settings/config-store', i18nKey: 'nav.configStore', icon: DatabaseIcon },
  { path: '/settings/authentication', i18nKey: 'nav.authentication', icon: LockIcon },
  { path: '/settings/pki', i18nKey: 'nav.pki', icon: KeyIcon },
  { path: '/settings/danger-zone', i18nKey: 'nav.dangerZone', icon: AlertTriangleIcon },
] as const

export const Route = createFileRoute('/settings')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/settings' || location.pathname === '/settings/') {
      throw redirect({ to: '/settings/general' })
    }
  },
  component: SettingsLayout,
})

function SettingsLayout() {
  const { t } = useTranslation('settings')
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Profile, users, and roles pages use full-width layout (no sub-nav)
  const fullWidthPaths = ['/settings/profile', '/settings/users', '/settings/roles']
  if (fullWidthPaths.some((p) => pathname.startsWith(p))) {
    return <Outlet />
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sub-navigation */}
        <nav className="w-full shrink-0 lg:w-56">
          <ul className="space-y-1">
            {settingsNavItems.map((item) => {
              const isActive = pathname === item.path
              const Icon = item.icon
              const isDanger = item.path === '/settings/danger-zone'
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      isDanger && !isActive && 'text-red-500 dark:text-red-400',
                      isDanger && isActive && 'bg-red-500/10 text-red-600 dark:text-red-400',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {t(item.i18nKey)}
                  </Link>
                </li>
              )
            })}
          </ul>
          <Slot zone="settings.nav" />
        </nav>

        {/* Page content */}
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
