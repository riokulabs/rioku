import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock data
const mockPolicies = [
  {
    id: 'pol-1',
    name: 'rate-limit-global',
    type: 'POLICY_TYPE_RATE_LIMIT',
    config: { requestsPerWindow: 100 },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
  {
    id: 'pol-2',
    name: 'cors-default',
    type: 'POLICY_TYPE_CORS',
    config: { allowedOrigins: ['*'] },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
  },
]

const mockRoutes = [
  {
    id: 'rt-1',
    name: 'api-route',
    matchers: [],
    serviceId: 'svc-1',
    policyIds: ['pol-1'],
    enabled: true,
    labels: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'rt-2',
    name: 'web-route',
    matchers: [],
    serviceId: 'svc-1',
    policyIds: ['pol-1', 'pol-2'],
    enabled: true,
    labels: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

let loaderData = { policies: mockPolicies, routes: mockRoutes }

// Mock dependencies
const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({
    useLoaderData: () => loaderData,
  }),
  Link: ({ children, to, params, ...props }: { children: React.ReactNode; to: string; params?: Record<string, string>; [k: string]: unknown }) => {
    const href = params ? to.replace('$policyId', params.policyId ?? '') : to
    return <a href={href} data-testid="router-link" {...props}>{children}</a>
  },
  useNavigate: () => mockNavigate,
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: (opts: { mutationFn: unknown; onSuccess?: () => void; onError?: () => void }) => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        title: 'Policies',
        subtitle: 'Manage rate limits, auth, and middleware policies',
        'table.name': 'Name',
        'table.type': 'Type',
        'table.attachedTo': 'Attached to',
        'table.updated': 'Updated',
        'table.actions': 'Actions',
        'form.createPolicy': 'Create policy',
        'form.editPolicy': 'Edit policy',
        'empty.noPolicies': 'No policies configured',
        'empty.noPoliciesDesc': 'Create a policy to apply rate limits.',
        'messages.confirmDelete': 'Are you sure?',
        'list.noRoutes': 'No routes',
        'list.routeCount': `${opts?.count ?? 0} route`,
        'list.routeCount_plural': `${opts?.count ?? 0} routes`,
      }
      return translations[key] ?? key
    },
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/api', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

vi.mock('@/components/rioku/page-header', () => ({
  PageHeader: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      <div data-testid="page-header-actions">{actions}</div>
    </div>
  ),
}))

vi.mock('@/components/rioku/data-table', () => ({
  DataTable: ({
    data,
    columns,
    emptyState,
    searchable,
    searchPlaceholder,
    rowActions,
  }: {
    data: Array<Record<string, unknown>>
    columns: Array<{ key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }>
    emptyState?: React.ReactNode
    searchable?: boolean
    searchPlaceholder?: string
    rowActions?: (row: Record<string, unknown>) => React.ReactNode
  }) => (
    <div data-testid="data-table">
      {searchable && <input placeholder={searchPlaceholder} data-testid="search-input" />}
      {data.length === 0 ? (
        <div data-testid="empty-state-wrapper">{emptyState}</div>
      ) : (
        <table>
          <thead>
            <tr>
              {columns.map((col) => <th key={col.key}>{col.header}</th>)}
              {rowActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={String(row.id ?? i)} data-testid="table-row">
                {columns.map((col) => (
                  <td key={col.key} data-testid={`cell-${col.key}`}>
                    {col.render ? col.render(row) : String(row[col.key] ?? '')}
                  </td>
                ))}
                {rowActions && <td data-testid="cell-actions">{rowActions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  ),
}))

vi.mock('@/components/rioku/empty-state', () => ({
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      {description && <span>{description}</span>}
      {action}
    </div>
  ),
}))

vi.mock('@/components/rioku/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    description,
    onConfirm,
  }: {
    open: boolean
    title: string
    description: string
    onConfirm: () => void
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <span>{title}</span>
        <span>{description}</span>
        <button onClick={onConfirm} data-testid="confirm-button">Confirm</button>
      </div>
    ) : null,
}))

vi.mock('@/components/rioku/time-ago', () => ({
  TimeAgo: ({ date }: { date: string }) => <span data-testid="time-ago">{date}</span>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, render, ...props }: React.ComponentProps<'button'> & { render?: React.ReactElement }) => {
    if (render) {
      const renderProps = (render as { props: Record<string, unknown> }).props ?? {}
      // Link's `to` prop becomes href for test assertions
      const href = renderProps.to as string | undefined
      return <a href={href} data-testid="button-link">{children}</a>
    }
    return <button onClick={onClick} {...props}>{children}</button>
  },
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <span data-testid="badge" data-variant={variant}>{children}</span>
  ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdown-menu">{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, variant }: { children: React.ReactNode; onClick?: () => void; variant?: string }) => (
    <button onClick={onClick} data-variant={variant} data-testid="dropdown-item">{children}</button>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <button data-testid="dropdown-trigger">{children}</button>
  ),
}))

import { PolicyListPage, POLICY_TYPES, policyTypeColors } from '../policies.index'

describe('PoliciesListPage', () => {
  beforeEach(() => {
    loaderData = { policies: mockPolicies, routes: mockRoutes }
    mockNavigate.mockReset()
  })

  it('renders policy names as clickable links to detail view', () => {
    render(<PolicyListPage />)

    const links = screen.getAllByTestId('router-link')
    const policyLinks = links.filter((l) => l.getAttribute('href')?.startsWith('/config/policies/'))
    expect(policyLinks).toHaveLength(2)
    expect(policyLinks[0]).toHaveAttribute('href', '/config/policies/pol-1')
    expect(policyLinks[1]).toHaveAttribute('href', '/config/policies/pol-2')
  })

  it('renders type badges with correct variant for each policy type', () => {
    render(<PolicyListPage />)

    const badges = screen.getAllByTestId('badge')
    expect(badges[0]).toHaveTextContent('Rate Limit')
    expect(badges[0]).toHaveAttribute('data-variant', 'default')
    expect(badges[1]).toHaveTextContent('CORS')
    expect(badges[1]).toHaveAttribute('data-variant', 'outline')
  })

  it('renders attached route count for each policy', () => {
    render(<PolicyListPage />)

    // pol-1 is attached to 2 routes
    expect(screen.getByText('2 routes')).toBeInTheDocument()
    // pol-2 is attached to 1 route
    expect(screen.getByText('1 route')).toBeInTheDocument()
  })

  it('renders Create policy link to /config/policies/create', () => {
    render(<PolicyListPage />)

    const createLinks = screen.getAllByTestId('button-link')
    const createLink = createLinks.find((l) => l.getAttribute('href') === '/config/policies/create')
    expect(createLink).toBeDefined()
  })

  it('renders policy name links to /config/policies/:id', () => {
    render(<PolicyListPage />)

    const links = screen.getAllByTestId('router-link')
    const firstPolicyLink = links.find((l) => l.getAttribute('href') === '/config/policies/pol-1')
    expect(firstPolicyLink).toBeDefined()
    expect(firstPolicyLink).toHaveTextContent('rate-limit-global')
  })

  it('shows delete confirmation dialog from more menu', async () => {
    const user = userEvent.setup()
    render(<PolicyListPage />)

    const deleteButtons = screen.getAllByTestId('dropdown-item')
    const deleteButton = deleteButtons.find((b) => b.getAttribute('data-variant') === 'destructive')
    expect(deleteButton).toBeDefined()

    await user.click(deleteButton!)
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
  })

  it('shows empty state with create action when no policies exist', () => {
    loaderData = { policies: [], routes: [] }
    render(<PolicyListPage />)

    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByText('No policies configured')).toBeInTheDocument()
  })

  it('renders page header with title', () => {
    render(<PolicyListPage />)

    expect(screen.getByText('Policies')).toBeInTheDocument()
  })

  it('exports POLICY_TYPES constant with all 8 types', () => {
    expect(Object.keys(POLICY_TYPES)).toHaveLength(8)
    expect(POLICY_TYPES.POLICY_TYPE_RATE_LIMIT).toBe('Rate Limit')
    expect(POLICY_TYPES.POLICY_TYPE_CORS).toBe('CORS')
    expect(POLICY_TYPES.POLICY_TYPE_TRANSFORM).toBe('Transform')
  })

  it('exports policyTypeColors constant', () => {
    expect(policyTypeColors.POLICY_TYPE_RATE_LIMIT).toBe('default')
    expect(policyTypeColors.POLICY_TYPE_CORS).toBe('outline')
    expect(policyTypeColors.POLICY_TYPE_CIRCUIT_BREAKER).toBe('destructive')
  })
})
