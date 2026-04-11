import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  LayoutDashboard,
  Route as RouteIcon,
  Server,
  Shield,
  Activity,
  BarChart3,
  Sparkles,
  Network,
  Puzzle,
  ShieldCheck,
  Settings,
  User as UserIcon,
  LogOut as LogOutIcon,
  Users as UsersIcon,
  KeyRound,
  ShieldAlert,
  ScrollText,
  ChevronsUpDown,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Slot } from '@/components/plugin/slot'
import { useCurrentUser, useHasPermission } from '@/hooks/use-auth'
import type { LucideIcon } from 'lucide-react'

interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  permission?: string
}

interface NavSection {
  titleKey: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    titleKey: 'nav.overview',
    items: [
      { label: 'nav.dashboard', path: '/', icon: LayoutDashboard },
    ],
  },
  {
    titleKey: 'nav.configuration',
    items: [
      { label: 'nav.routes', path: '/config/routes', icon: RouteIcon },
      { label: 'nav.services', path: '/config/services', icon: Server },
      { label: 'nav.policies', path: '/config/policies', icon: Shield },
    ],
  },
  {
    titleKey: 'nav.traffic',
    items: [
      { label: 'nav.live', path: '/traffic/live', icon: Activity },
      { label: 'nav.analytics', path: '/traffic/analytics', icon: BarChart3 },
      { label: 'nav.aiWorkloads', path: '/traffic/ai', icon: Sparkles },
    ],
  },
  {
    titleKey: 'nav.infrastructure',
    items: [
      { label: 'nav.cluster', path: '/cluster', icon: Network },
      { label: 'nav.certificates', path: '/certificates', icon: ShieldCheck },
      { label: 'nav.plugins', path: '/plugins', icon: Puzzle },
    ],
  },
  {
    titleKey: 'nav.security',
    items: [
      { label: 'nav.usersAndRoles', path: '/settings/users', icon: UsersIcon, permission: 'users:read' },
      { label: 'nav.apiKeys', path: '/security/api-keys', icon: KeyRound },
      { label: 'nav.accessPolicies', path: '/security/access-policies', icon: ShieldAlert },
      { label: 'nav.auditLog', path: '/security/audit-log', icon: ScrollText },
    ],
  },
]

/** All navigation items as a flat list (used by command palette). */
export const allNavItems = navSections.flatMap((s) => s.items)

function RiokuLogo() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="hex-gradient" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <path
        d="M16 2 L28.124 9 L28.124 23 L16 30 L3.876 23 L3.876 9 Z"
        fill="url(#hex-gradient)"
        opacity="0.9"
      />
      <text
        x="16"
        y="20"
        textAnchor="middle"
        fill="white"
        fontSize="14"
        fontWeight="700"
        fontFamily="sans-serif"
      >
        R
      </text>
    </svg>
  )
}

function isActive(itemPath: string, currentPath: string): boolean {
  if (itemPath === '/') return currentPath === '/'
  return currentPath.startsWith(itemPath)
}

function AppSidebar() {
  const { t } = useTranslation()
  const { state } = useSidebar()
  const routerState = useRouterState()
  const navigate = useNavigate()
  const currentPath = routerState.location.pathname
  const currentUser = useCurrentUser()
  const canViewUsers = useHasPermission('users:read')

  async function handleLogout() {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
    await navigate({ to: '/login' })
  }

  function shouldShowItem(item: NavItem): boolean {
    if (!item.permission) return true
    if (item.permission === 'users:read') return canViewUsers
    return true
  }

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1">
          <RiokuLogo />
          {state === 'expanded' && (
            <span className="text-base font-semibold tracking-tight">Rioku</span>
          )}
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        {navSections.map((section) => (
          <SidebarGroup key={section.titleKey}>
            <SidebarGroupLabel>{t(section.titleKey, section.titleKey.split('.').pop() ?? '')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  if (!shouldShowItem(item)) return null
                  const Icon = item.icon
                  const active = isActive(item.path, currentPath)
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={t(item.label, item.label.split('.').pop() ?? '')}
                        render={<Link to={item.path} />}
                      >
                        <Icon />
                        <span>{t(item.label, item.label.split('.').pop() ?? '')}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <Popover>
              <PopoverTrigger
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                data-testid="user-menu-trigger"
              >
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <UserIcon className="size-3.5" />
                </div>
                {state === 'expanded' && currentUser && (
                  <>
                    <span className="truncate flex-1 font-medium">
                      {currentUser.displayName ?? currentUser.username}
                    </span>
                    <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
                  </>
                )}
              </PopoverTrigger>
              <PopoverContent side="top" sideOffset={8} align="start" className="w-56 p-1">
                <Link
                  to="/settings/profile"
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <UserIcon className="size-4" />
                  <span>{t('nav.profile', 'Profile')}</span>
                </Link>
                <Link
                  to="/settings"
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <Settings className="size-4" />
                  <span>{t('nav.settings', 'Settings')}</span>
                </Link>
                <Separator className="my-1" />
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <LogOutIcon className="size-4" />
                  <span>{t('auth.logout', 'Log out')}</span>
                </button>
              </PopoverContent>
            </Popover>
          </SidebarMenuItem>
        </SidebarMenu>
        <Slot zone="sidebar.bottom" />
      </SidebarFooter>
    </Sidebar>
  )
}

export { AppSidebar }
