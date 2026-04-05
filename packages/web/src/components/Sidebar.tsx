import { Link, useRouterState } from '@tanstack/react-router'
import { useTheme } from '../theme'

const navSections = [
  {
    label: 'Overview',
    links: [
      { to: '/', icon: '\u2B21', label: 'Dashboard' },
    ],
  },
  {
    label: 'Configuration',
    links: [
      { to: '/config/routes', icon: '\u2192', label: 'Routes' },
      { to: '/config/services', icon: '\u25CB', label: 'Services' },
      { to: '/config/policies', icon: '\u25A1', label: 'Policies' },
    ],
  },
  {
    label: 'Traffic',
    links: [
      { to: '/traffic/live', icon: '\u25C9', label: 'Live' },
      { to: '/traffic/analytics', icon: '\u25B3', label: 'Analytics' },
      { to: '/traffic/ai', icon: '\u2726', label: 'AI Workloads' },
    ],
  },
  {
    label: 'Infrastructure',
    links: [
      { to: '/cluster', icon: '\u2B22', label: 'Cluster' },
      { to: '/plugins', icon: '\u29C9', label: 'Plugins' },
    ],
  },
  {
    label: 'Security',
    links: [
      { to: '/security', icon: '\u25C8', label: 'Security' },
    ],
  },
] as const

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { theme, toggleTheme } = useTheme()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  return (
    <>
      <div
        className={`sidebar-overlay${isOpen ? ' open' : ''}`}
        onClick={onClose}
      />
      <aside className={`sidebar${isOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <svg className="sidebar-logo-icon" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>
            <polygon points="50,8 89,29 89,71 50,92 11,71 11,29" fill="url(#logo-gradient)" />
            <text x="50" y="64" textAnchor="middle" fontFamily="system-ui" fontSize="42" fontWeight="700" fill="white">R</text>
          </svg>
          <span className="sidebar-logo-text">Rioku</span>
          <button
            className="theme-toggle sidebar-logo-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '\u263C' : '\u263E'}
          </button>
        </div>

        <nav className="sidebar-nav">
          {navSections.map((section) => (
            <div key={section.label} className="sidebar-section">
              <div className="sidebar-section-label">{section.label}</div>
              {section.links.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`sidebar-link${currentPath === link.to ? ' active' : ''}`}
                  onClick={onClose}
                >
                  <span className="sidebar-link-icon">{link.icon}</span>
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <Link
            to="/settings"
            className={`sidebar-link${currentPath === '/settings' ? ' active' : ''}`}
            onClick={onClose}
          >
            <span className="sidebar-link-icon">{'\u2699'}</span>
            Settings
          </Link>
        </div>
      </aside>
    </>
  )
}
