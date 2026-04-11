import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockRoles = [
  { id: 'r1', name: 'superadmin', description: 'Full access', isBuiltin: true, permissions: ['all'], createdAt: '', updatedAt: '' },
  { id: 'r2', name: 'viewer', description: 'Read only', isBuiltin: true, permissions: ['view'], createdAt: '', updatedAt: '' },
]

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => () => ({ useLoaderData: () => mockRoles }), Link: ({ children, to, params }: { children: React.ReactNode; to: string; params?: Record<string, string> }) => { const href = params ? to.replace('$roleId', params.roleId ?? '') : to; return <a href={href} data-testid="router-link">{children}</a> } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('@/hooks/use-auth', () => ({ useHasPermission: () => true }))
vi.mock('lucide-react', () => ({ PlusIcon: () => <span />, ShieldIcon: () => <span /> }))
vi.mock('@/components/rioku/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <div><h1>{title}</h1></div> }))
vi.mock('@/components/rioku/data-table', () => ({ DataTable: ({ data, columns }: { data: Array<Record<string, unknown>>; columns: Array<{ key: string; render?: (r: Record<string, unknown>) => React.ReactNode }> }) => <table><tbody>{data.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : String(r[c.key] ?? '')}</td>)}</tr>)}</tbody></table> }))
vi.mock('@/components/rioku/empty-state', () => ({ EmptyState: () => <div /> }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, render }: React.ComponentProps<'button'> & { render?: React.ReactElement }) => render ? <a>{children}</a> : <button>{children}</button> }))
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span> }))

import { RolesListPage } from '../roles.index'

describe('RolesListPage', () => {
  it('renders role names as clickable links', () => { render(<RolesListPage />); expect(screen.getByText('superadmin')).toBeInTheDocument(); expect(screen.getByText('viewer')).toBeInTheDocument() })
  it('shows built-in badge for system roles', () => { render(<RolesListPage />); const badges = screen.getAllByTestId('badge'); expect(badges.some(b => b.textContent === 'Built-in')).toBe(true) })
  it('renders page header', () => { render(<RolesListPage />); expect(screen.getByText('Roles')).toBeInTheDocument() })
  it('renders permission count', () => { render(<RolesListPage />); expect(screen.getAllByText('1 permissions')).toHaveLength(2) })
})
