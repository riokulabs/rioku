import { useRouterState } from '@tanstack/react-router'
import { useTheme } from '../theme'

const pathLabels: Record<string, [string, string]> = {
  '/': ['Overview', 'Dashboard'],
  '/config/routes': ['Configuration', 'Routes'],
  '/config/services': ['Configuration', 'Services'],
  '/config/policies': ['Configuration', 'Policies'],
  '/traffic/live': ['Traffic', 'Live'],
  '/traffic/analytics': ['Traffic', 'Analytics'],
  '/traffic/ai': ['Traffic', 'AI Workloads'],
  '/cluster': ['Infrastructure', 'Cluster'],
  '/plugins': ['Infrastructure', 'Plugins'],
  '/security': ['Security', 'Security'],
  '/settings': ['System', 'Settings'],
}

interface HeaderProps {
  onMenuToggle: () => void
}

export function Header({ onMenuToggle }: HeaderProps) {
  const { theme, toggleTheme } = useTheme()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const [section, page] = pathLabels[currentPath] ?? ['', '']

  return (
    <header className="header">
      <button className="header-hamburger" onClick={onMenuToggle}>
        {'\u2630'}
      </button>

      <div className="header-breadcrumb">
        <span>{section}</span>
        {page && page !== section && (
          <>
            <span className="header-breadcrumb-separator">/</span>
            <span className="header-breadcrumb-current">{page}</span>
          </>
        )}
      </div>

      <div className="header-spacer" />

      <input
        type="text"
        className="header-search"
        placeholder="Search... (Ctrl+K)"
        readOnly
      />

      <button
        className="theme-toggle"
        onClick={toggleTheme}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? '\u263C' : '\u263E'}
      </button>
    </header>
  )
}
