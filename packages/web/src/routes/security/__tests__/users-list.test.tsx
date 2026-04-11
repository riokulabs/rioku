import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockUsers = [
  { id: 'u1', username: 'admin', displayName: 'Admin', email: 'admin@example.com', roles: ['superadmin'], permissions: [], totpEnabled: true, forcePasswordChange: false, status: 'active', lastLogin: '2026-01-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z' },
  { id: 'u2', username: 'viewer', displayName: 'Viewer', email: 'viewer@example.com', roles: ['viewer'], permissions: [], totpEnabled: false, forcePasswordChange: false, status: 'suspended', lastLogin: null, createdAt: '2025-06-01T00:00:00Z' },
]
const mockRoles = [
  { id: 'r1', name: 'superadmin', description: '', isBuiltin: true, permissions: [], createdAt: '', updatedAt: '' },
  { id: 'r2', name: 'viewer', description: '', isBuiltin: true, permissions: [], createdAt: '', updatedAt: '' },
]

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useLoaderData: () => [mockUsers, mockRoles] }),
  Link: ({ children, to, params }: { children: React.ReactNode; to: string; params?: Record<string, string> }) => {
    const href = params ? to.replace('$userId', params.userId ?? '') : to
    return <a href={href} data-testid="router-link">{children}</a>
  },
  useNavigate: () => vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('@/hooks/use-auth', () => ({ useHasPermission: () => true }))
vi.mock('lucide-react', () => ({ PlusIcon: () => <span />, ShieldIcon: () => <span />, MoreHorizontalIcon: () => <span />, TrashIcon: () => <span />, UserIcon: () => <span /> }))
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
vi.mock('@/components/ui/dropdown-menu', () => ({ DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <button>{children}</button>, DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button> }))

import { UsersListPage } from '../users.index'

describe('UsersListPage', () => {
  it('renders user table with username as clickable link', () => {
    render(<UsersListPage />)
    const links = screen.getAllByTestId('router-link')
    expect(links.some(l => l.getAttribute('href')?.includes('/security/users/u1'))).toBe(true)
    expect(screen.getByText('admin')).toBeInTheDocument()
  })

  it('renders role badges per user', () => {
    render(<UsersListPage />)
    expect(screen.getByText('superadmin')).toBeInTheDocument()
    // "viewer" appears both as username and role badge
    expect(screen.getAllByText('viewer').length).toBeGreaterThanOrEqual(1)
  })

  it('renders status badge', () => {
    render(<UsersListPage />)
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('suspended')).toBeInTheDocument()
  })

  it('renders MFA status', () => {
    render(<UsersListPage />)
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('Off')).toBeInTheDocument()
  })

  it('renders page header', () => {
    render(<UsersListPage />)
    expect(screen.getByTestId('page-header')).toBeInTheDocument()
  })
})
