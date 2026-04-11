import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockRole = { id: 'r1', name: 'operator', description: 'Operator role', isBuiltin: false, permissions: [], createdAt: '', updatedAt: '', parentRoleIds: [], childRoleIds: [], rules: [] }
const mockAllRoles = [mockRole]
const mockMembers = [{ id: 'u1', username: 'alice', email: 'alice@example.com', displayName: null, roles: ['operator'], permissions: [], totpEnabled: false, forcePasswordChange: false, status: 'active' as const, lastLogin: null, createdAt: '' }]

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => () => ({ useLoaderData: () => ({ role: mockRole, allRoles: mockAllRoles, members: mockMembers }) }), Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to} data-testid="router-link">{children}</a>, useNavigate: () => vi.fn() }))
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn(), del: vi.fn() } }))
vi.mock('lucide-react', () => ({ ArrowLeftIcon: () => <span />, TrashIcon: () => <span /> }))
vi.mock('@/components/rioku/permission-rule-editor', () => ({ PermissionRuleEditor: ({ value }: { value: unknown[] }) => <div data-testid="rule-editor">{value.length} rules</div> }))
vi.mock('@/components/rioku/role-hierarchy-tree', () => ({ RoleHierarchyTree: () => <div data-testid="hierarchy-tree" /> }))
vi.mock('@/components/rioku/confirm-dialog', () => ({ ConfirmDialog: ({ open }: { open: boolean }) => open ? <div data-testid="confirm-dialog" /> : null }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, onClick, ...props }: React.ComponentProps<'button'>) => <button onClick={onClick} {...props}>{children}</button> }))
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span> }))
vi.mock('@/components/ui/tabs', () => ({ Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) => <button data-testid={`tab-${value}`}>{children}</button>, TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/ui/card', () => ({ Card: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>, CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3> }))

import { RoleDetailPage } from '../roles.$roleId'

describe('RoleDetailPage', () => {
  it('renders role name', () => { render(<RoleDetailPage />); expect(screen.getByText('operator')).toBeInTheDocument() })
  it('renders tabs for permissions, hierarchy, members', () => { render(<RoleDetailPage />); expect(screen.getByTestId('tab-permissions')).toBeInTheDocument(); expect(screen.getByTestId('tab-hierarchy')).toBeInTheDocument(); expect(screen.getByTestId('tab-members')).toBeInTheDocument() })
  it('renders permission rule editor', () => { render(<RoleDetailPage />); expect(screen.getByTestId('rule-editor')).toBeInTheDocument() })
  it('renders hierarchy tree', () => { render(<RoleDetailPage />); expect(screen.getByTestId('hierarchy-tree')).toBeInTheDocument() })
  it('renders members list', () => { render(<RoleDetailPage />); expect(screen.getByText('alice')).toBeInTheDocument() })
  it('renders delete button for non-builtin role', () => { render(<RoleDetailPage />); expect(screen.getByText('Delete role')).toBeInTheDocument() })
  it('renders back link to roles list', () => { render(<RoleDetailPage />); expect(screen.getByText('Back to roles')).toBeInTheDocument() })
})
