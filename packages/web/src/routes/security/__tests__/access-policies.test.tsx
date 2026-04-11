import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockPolicies = [
  { id: 'ap-1', name: 'Office Hours Only', description: '', effect: 'deny', targetType: 'roles', targetIds: ['role-operator'], conditions: [{ type: 'time', config: {} }], priority: 10, enabled: true, createdAt: '', updatedAt: '' },
  { id: 'ap-2', name: 'VPN Required', description: '', effect: 'deny', targetType: 'roles', targetIds: ['role-admin'], conditions: [{ type: 'ip', config: {} }], priority: 5, enabled: false, createdAt: '', updatedAt: '' },
]

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useLoaderData: () => mockPolicies }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to} data-testid="router-link">{children}</a>,
  useNavigate: () => vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => { const t: Record<string, string> = { title: 'Access Policies', subtitle: 'Conditional access rules', 'list.createPolicy': 'Create access policy', 'detail.backToList': 'Back to access policies' }; return t[k] ?? k } }) }))
vi.mock('lucide-react', () => ({ PlusIcon: () => <span />, ShieldAlertIcon: () => <span />, ArrowLeftIcon: () => <span /> }))
vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }))
vi.mock('@/components/rioku/page-header', () => ({ PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <div><h1>{title}</h1>{actions}</div> }))
vi.mock('@/components/rioku/data-table', () => ({ DataTable: ({ data, columns }: { data: unknown[]; columns: { header: string }[] }) => <div data-testid="data-table"><span>Rows: {data.length}</span>{columns.map((c) => <span key={c.header}>{c.header}</span>)}</div> }))
vi.mock('@/components/rioku/empty-state', () => ({ EmptyState: ({ title, description }: { title: string; description?: string }) => <div data-testid="empty-state"><span>{title}</span>{description && <span>{description}</span>}</div> }))
vi.mock('@/components/rioku/condition-editor', () => ({ ConditionEditor: () => <div data-testid="condition-editor" /> }))
vi.mock('@/components/rioku/tag-input', () => ({ TagInput: ({ label }: { label?: string }) => <div data-testid="tag-input">{label}</div> }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, render, onClick, disabled, ...props }: React.ComponentProps<'button'> & { render?: React.ReactElement }) => render ? <a data-testid="button-link">{children}</a> : <button onClick={onClick} disabled={disabled} {...props}>{children}</button> }))
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock('@/components/ui/input', () => ({ Input: (props: React.ComponentProps<'input'>) => <input {...props} /> }))
vi.mock('@/components/ui/label', () => ({ Label: ({ children, ...props }: React.ComponentProps<'label'>) => <label {...props}>{children}</label> }))
vi.mock('@/components/ui/select', () => ({ Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>, SelectItem: ({ children }: { children: React.ReactNode }) => <option>{children}</option>, SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, SelectValue: () => <span /> }))
vi.mock('@/components/ui/switch', () => ({ Switch: () => <button role="switch" /> }))
vi.mock('@/components/ui/card', () => ({ Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3> }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { AccessPoliciesListPage } from '../access-policies.index'
import { AccessPolicyCreatePage } from '../access-policies.create'

describe('AccessPoliciesListPage', () => {
  it('renders page title', () => { render(<AccessPoliciesListPage />); expect(screen.getByText('Access Policies')).toBeInTheDocument() })
  it('renders data table with policies', () => { render(<AccessPoliciesListPage />); expect(screen.getByTestId('data-table')).toBeInTheDocument(); expect(screen.getByText('Rows: 2')).toBeInTheDocument() })
  it('renders create button', () => { render(<AccessPoliciesListPage />); expect(screen.getAllByText('Create access policy').length).toBeGreaterThanOrEqual(1) })
})

describe('AccessPolicyCreatePage', () => {
  it('renders create heading', () => { render(<AccessPolicyCreatePage />); expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create access policy') })
  it('renders condition editor', () => { render(<AccessPolicyCreatePage />); expect(screen.getByTestId('condition-editor')).toBeInTheDocument() })
  it('renders name input', () => { render(<AccessPolicyCreatePage />); expect(screen.getByLabelText('Name')).toBeInTheDocument() })
  it('renders effect selector', () => { render(<AccessPolicyCreatePage />); expect(screen.getByText('Effect')).toBeInTheDocument() })
  it('renders back link', () => { render(<AccessPolicyCreatePage />); expect(screen.getByText('Back to access policies')).toBeInTheDocument() })
  it('renders target type selector', () => { render(<AccessPolicyCreatePage />); expect(screen.getByText('Target Type')).toBeInTheDocument() })
  it('renders priority input', () => { render(<AccessPolicyCreatePage />); expect(screen.getByLabelText('Priority')).toBeInTheDocument() })
})
