import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
  Link: ({ children, to, params }: { children: React.ReactNode; to: string; params?: Record<string, string> }) => {
    const href = params ? to.replace('$userId', params.userId ?? '') : to
    return <a href={href} data-testid="router-link">{children}</a>
  },
  useNavigate: () => vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('@/hooks/use-auth', () => ({ useHasPermission: () => true }))
vi.mock('@/components/rioku/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <div data-testid="page-header"><h1>{title}</h1></div> }))
vi.mock('@/components/rioku/data-table', () => ({
  DataTable: ({ data, columns }: { data: Array<Record<string, unknown>>; columns: Array<{ key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }> }) => (
    <table data-testid="data-table"><tbody>{data.map((row, i) => (
      <tr key={i}>{columns.map((col) => <td key={col.key}>{col.render ? col.render(row) : String(row[col.key] ?? '')}</td>)}</tr>
    ))}</tbody></table>
  ),
}))
vi.mock('@/components/rioku/empty-state', () => ({ EmptyState: () => <div data-testid="empty-state" /> }))
vi.mock('@/components/rioku/time-ago', () => ({ TimeAgo: ({ date }: { date: string }) => <span>{date}</span> }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, render, ...props }: React.ComponentProps<'button'> & { render?: React.ReactElement }) => { if (render) return <a data-testid="button-link">{children}</a>; return <button {...props}>{children}</button> } }))
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span> }))
vi.mock('@/components/ui/switch', () => ({ Switch: () => <input type="checkbox" data-testid="switch" /> }))
vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}))
vi.mock('@/components/ui/input', () => ({ Input: (props: React.ComponentProps<'input'>) => <input {...props} /> }))
vi.mock('@/components/ui/label', () => ({ Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label> }))
vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children, value }: { children: React.ReactNode; value: string }) => <div data-testid="tabs" data-value={value}>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div data-testid="tabs-list">{children}</div>,
  TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) => <button data-testid="tabs-trigger" data-value={value}>{children}</button>,
  TabsContent: ({ children, value }: { children: React.ReactNode; value: string }) => <div data-testid="tabs-content" data-value={value}>{children}</div>,
}))
vi.mock('@rioku/ui', () => ({
  SearchableSelect: () => <select data-testid="searchable-select" />,
  SearchableMultiSelect: () => <select data-testid="searchable-multi-select" />,
}))

import { UsersSecurityPage } from '../users.index'

describe('UsersSecurityPage', () => {
  it('renders page header with Users & Access title', () => {
    render(<UsersSecurityPage />)
    expect(screen.getByTestId('page-header')).toBeInTheDocument()
    expect(screen.getByText('Users & Access')).toBeInTheDocument()
  })

  it('renders three tabs: Users, Roles, Access Policies', () => {
    render(<UsersSecurityPage />)
    const triggers = screen.getAllByTestId('tabs-trigger')
    expect(triggers.length).toBe(3)
    // Check tab trigger values
    expect(triggers[0]).toHaveAttribute('data-value', 'users')
    expect(triggers[1]).toHaveAttribute('data-value', 'roles')
    expect(triggers[2]).toHaveAttribute('data-value', 'policies')
  })

  it('renders users table with mock user data', () => {
    render(<UsersSecurityPage />)
    // Admin user from inline mock data
    expect(screen.getByText('Derrick Mehaffy')).toBeInTheDocument()
    // "Jane Doe" may appear multiple times (users tab + role members), use getAllByText
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0)
    expect(screen.getByText('Alex Kim')).toBeInTheDocument()
  })

  it('renders role badges in user rows', () => {
    render(<UsersSecurityPage />)
    const badges = screen.getAllByTestId('badge')
    expect(badges.length).toBeGreaterThan(0)
  })

  it('renders MFA status for users', () => {
    render(<UsersSecurityPage />)
    // At least one user has MFA enabled
    expect(screen.getAllByText('Enabled').length).toBeGreaterThan(0)
  })
})
