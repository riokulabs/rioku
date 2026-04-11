import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => () => ({}), Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to} data-testid="router-link">{children}</a>, useNavigate: () => vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => { const t: Record<string, string> = { title: 'Access Policies', subtitle: 'Conditional access rules', 'list.createPolicy': 'Create access policy', 'detail.backToList': 'Back to access policies' }; return t[k] ?? k } }) }))
vi.mock('lucide-react', () => ({ PlusIcon: () => <span />, ShieldAlertIcon: () => <span />, ArrowLeftIcon: () => <span /> }))
vi.mock('@/components/rioku/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <div><h1>{title}</h1></div> }))
vi.mock('@/components/rioku/empty-state', () => ({ EmptyState: ({ title, description }: { title: string; description?: string }) => <div data-testid="empty-state"><span>{title}</span>{description && <span>{description}</span>}</div> }))
vi.mock('@/components/rioku/condition-editor', () => ({ ConditionEditor: () => <div data-testid="condition-editor" /> }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, render, ...props }: React.ComponentProps<'button'> & { render?: React.ReactElement }) => render ? <a data-testid="button-link">{children}</a> : <button {...props}>{children}</button> }))
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock('@/components/ui/input', () => ({ Input: (props: React.ComponentProps<'input'>) => <input {...props} /> }))
vi.mock('@/components/ui/label', () => ({ Label: ({ children, ...props }: React.ComponentProps<'label'>) => <label {...props}>{children}</label> }))
vi.mock('@/components/ui/select', () => ({ Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>, SelectItem: ({ children }: { children: React.ReactNode }) => <option>{children}</option>, SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, SelectValue: () => <span /> }))
vi.mock('@/components/ui/switch', () => ({ Switch: () => <button role="switch" /> }))
vi.mock('@/components/ui/card', () => ({ Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3> }))

import { AccessPoliciesListPage } from '../access-policies.index'
import { AccessPolicyCreatePage } from '../access-policies.create'

describe('AccessPoliciesListPage', () => {
  it('renders page title', () => { render(<AccessPoliciesListPage />); expect(screen.getByText('Access Policies')).toBeInTheDocument() })
  it('renders coming soon message', () => { render(<AccessPoliciesListPage />); expect(screen.getByTestId('empty-state')).toBeInTheDocument() })
})

describe('AccessPolicyCreatePage', () => {
  it('renders create heading', () => { render(<AccessPolicyCreatePage />); expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create access policy') })
  it('renders condition editor', () => { render(<AccessPolicyCreatePage />); expect(screen.getByTestId('condition-editor')).toBeInTheDocument() })
  it('renders name input', () => { render(<AccessPolicyCreatePage />); expect(screen.getByLabelText('Name')).toBeInTheDocument() })
  it('renders effect selector', () => { render(<AccessPolicyCreatePage />); expect(screen.getByText('Effect')).toBeInTheDocument() })
  it('renders back link', () => { render(<AccessPolicyCreatePage />); expect(screen.getByText('Back to access policies')).toBeInTheDocument() })
})
