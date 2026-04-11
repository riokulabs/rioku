import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockUser = { id: 'u1', username: 'admin', displayName: 'Admin User', email: 'admin@example.com', roles: ['superadmin'], permissions: [], totpEnabled: true, forcePasswordChange: false, status: 'active' as const, lastLogin: '2026-01-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z' }
const mockRoles = [{ id: 'r1', name: 'superadmin', description: '', isBuiltin: true, permissions: [], createdAt: '', updatedAt: '' }]

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useLoaderData: () => ({ user: mockUser, allRoles: mockRoles }) }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to} data-testid="router-link">{children}</a>,
  useNavigate: () => vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => { const t: Record<string, string> = { 'detail.backToList': 'Back to users', 'detail.identityCard': 'Identity', 'detail.rolesCard': 'Roles', 'detail.securityCard': 'Security', 'detail.dangerZone': 'Danger zone', 'detail.deleteUser': 'Delete user', 'detail.deleteConfirmation': 'Type the username to confirm deletion.', 'detail.changePassword': 'Change password' }; return t[k] ?? k } }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn(), del: vi.fn() } }))
vi.mock('lucide-react', () => ({ ArrowLeftIcon: () => <span />, TrashIcon: () => <span />, CopyIcon: () => <span /> }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, onClick, disabled, ...props }: React.ComponentProps<'button'>) => <button onClick={onClick} disabled={disabled}>{children}</button> }))
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span> }))
vi.mock('@/components/ui/input', () => ({ Input: (props: React.ComponentProps<'input'>) => <input {...props} /> }))
vi.mock('@/components/ui/label', () => ({ Label: ({ children, ...props }: React.ComponentProps<'label'>) => <label {...props}>{children}</label> }))
vi.mock('@/components/ui/card', () => ({ Card: ({ children, className }: { children: React.ReactNode; className?: string }) => <div data-testid="card" className={className}>{children}</div>, CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3> }))
vi.mock('@/components/rioku/confirm-dialog', () => ({ ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => open ? <div data-testid="confirm-dialog"><button onClick={onConfirm}>Confirm</button></div> : null }))
vi.mock('@/components/rioku/time-ago', () => ({ TimeAgo: ({ date }: { date: string }) => <span data-testid="time-ago">{date}</span> }))

import { UserDetailPage } from '../users.$userId'

describe('UserDetailPage', () => {
  it('renders user username in heading', () => {
    render(<UserDetailPage />)
    expect(screen.getByText('admin')).toBeInTheDocument()
  })

  it('renders back link to /security/users', () => {
    render(<UserDetailPage />)
    const links = screen.getAllByTestId('router-link')
    expect(links.some(l => l.getAttribute('href') === '/security/users')).toBe(true)
  })

  it('renders identity card', () => {
    render(<UserDetailPage />)
    expect(screen.getByText('Identity')).toBeInTheDocument()
  })

  it('renders roles card with role badges', () => {
    render(<UserDetailPage />)
    expect(screen.getByText('Roles')).toBeInTheDocument()
    expect(screen.getByText('superadmin')).toBeInTheDocument()
  })

  it('renders security card', () => {
    render(<UserDetailPage />)
    expect(screen.getByText('Security')).toBeInTheDocument()
  })

  it('renders MFA status', () => {
    render(<UserDetailPage />)
    expect(screen.getByText('Enabled')).toBeInTheDocument()
  })

  it('renders danger zone with delete button', () => {
    render(<UserDetailPage />)
    expect(screen.getByText('Danger zone')).toBeInTheDocument()
    expect(screen.getByText('Delete user')).toBeInTheDocument()
  })

  it('disables delete until username typed', () => {
    render(<UserDetailPage />)
    const deleteButton = screen.getByText('Delete user').closest('button')!
    expect(deleteButton).toBeDisabled()
  })

  it('renders account ID', () => {
    render(<UserDetailPage />)
    expect(screen.getByText('u1')).toBeInTheDocument()
  })

  it('renders NEEDS BACKEND fields as disabled', () => {
    render(<UserDetailPage />)
    expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThanOrEqual(1)
  })
})
