import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockPolicy = {
  id: 'pol-1',
  name: 'rate-limit-global',
  type: 'POLICY_TYPE_RATE_LIMIT',
  config: { requestsPerWindow: 100, windowUnit: 'minute', scope: 'per_ip' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
}

const mockRoutes = [
  {
    id: 'rt-1',
    name: 'api-route',
    matchers: [{ hosts: ['api.example.com'], paths: [{ type: 'prefix', value: '/v1' }] }],
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
    policyIds: ['pol-2'],
    enabled: true,
    labels: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

let loaderData = { policy: mockPolicy, routes: mockRoutes }
let searchParams = new URLSearchParams()
const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({
    useLoaderData: () => loaderData,
  }),
  Link: ({ children, to, params, ...props }: { children: React.ReactNode; to: string; params?: Record<string, string>; [k: string]: unknown }) => {
    const href = params ? to.replace(/\$\w+/g, (m) => params[m.slice(1)] ?? m) : to
    return <a href={href} data-testid="router-link" {...props}>{children}</a>
  },
  useNavigate: () => mockNavigate,
  useSearch: () => Object.fromEntries(searchParams.entries()),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const t: Record<string, string> = {
        'detail.backToList': 'Back to policies',
        'detail.configuration': 'Configuration',
        'detail.attachedRoutes': 'Attached routes',
        'detail.activity': 'Activity',
        'detail.editConfig': 'Edit',
        'detail.cancelEdit': 'Cancel',
        'detail.saveConfig': 'Save',
        'detail.codeMode': 'Code',
        'detail.dangerZone': 'Danger zone',
        'detail.deletePolicy': 'Delete policy',
        'messages.policyUpdated': 'Policy updated',
        'messages.confirmDelete': 'Are you sure?',
      }
      return t[key] ?? key
    },
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }))

vi.mock('../policies.index', () => ({
  POLICY_TYPES: {
    POLICY_TYPE_RATE_LIMIT: 'Rate Limit',
    POLICY_TYPE_AUTH_API_KEY: 'API Key Auth',
    POLICY_TYPE_AUTHENTICATION: 'Authentication',
    POLICY_TYPE_CORS: 'CORS',
    POLICY_TYPE_CIRCUIT_BREAKER: 'Circuit Breaker',
    POLICY_TYPE_RETRY: 'Retry',
    POLICY_TYPE_CACHE: 'Cache',
    POLICY_TYPE_TRANSFORM: 'Transform',
  },
  policyTypeColors: {
    POLICY_TYPE_RATE_LIMIT: 'default',
    POLICY_TYPE_CORS: 'outline',
    POLICY_TYPE_CIRCUIT_BREAKER: 'destructive',
  },
}))

vi.mock('@/components/rioku/page-header', () => ({
  PageHeader: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) => (
    <div data-testid="page-header"><h1>{title}</h1>{actions}</div>
  ),
}))

vi.mock('@/components/rioku/data-table', () => ({
  DataTable: ({ data }: { data: Array<Record<string, unknown>> }) => (
    <div data-testid="routes-table">{data.map((r, i) => <div key={i}>{String(r.name)}</div>)}</div>
  ),
}))

vi.mock('@/components/rioku/confirm-dialog', () => ({
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? <div data-testid="confirm-dialog"><button onClick={onConfirm}>Confirm</button></div> : null,
}))

vi.mock('@/components/rioku/time-ago', () => ({
  TimeAgo: ({ date }: { date: string }) => <span data-testid="time-ago">{date}</span>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: React.ComponentProps<'button'>) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <span data-testid="badge" data-variant={variant}>{children}</span>
  ),
}))

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children, defaultValue, value, onValueChange, ...props }: { children: React.ReactNode; defaultValue?: string; value?: string; onValueChange?: (v: string) => void }) => (
    <div data-testid="tabs" data-value={value ?? defaultValue} {...props}>{children}</div>
  ),
  TabsList: ({ children, ...props }: { children: React.ReactNode }) => <div data-testid="tabs-list" {...props}>{children}</div>,
  TabsTrigger: ({ children, value, ...props }: { children: React.ReactNode; value: string }) => (
    <button data-testid={`tab-${value}`} data-value={value} {...props}>{children}</button>
  ),
  TabsContent: ({ children, value, ...props }: { children: React.ReactNode; value: string }) => (
    <div data-testid={`tab-content-${value}`} data-value={value} {...props}>{children}</div>
  ),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => <div data-testid="card" className={className}>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div data-testid="card-content">{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="card-header">{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}))

vi.mock('lucide-react', () => ({
  ArrowLeftIcon: () => <span data-testid="arrow-left" />,
  PencilIcon: () => <span />,
  CodeIcon: () => <span />,
  TrashIcon: () => <span />,
}))

import { PolicyDetailPage } from '../policies.$policyId'

describe('PolicyDetailPage', () => {
  beforeEach(() => {
    loaderData = { policy: mockPolicy, routes: mockRoutes }
    searchParams = new URLSearchParams()
    mockNavigate.mockReset()
  })

  it('renders policy name in header with back link to /config/policies', () => {
    render(<PolicyDetailPage />)

    const backLinks = screen.getAllByTestId('router-link')
    const backLink = backLinks.find((l) => l.getAttribute('href') === '/config/policies')
    expect(backLink).toBeDefined()
    expect(screen.getByText('rate-limit-global')).toBeInTheDocument()
  })

  it('renders type badge next to policy name', () => {
    render(<PolicyDetailPage />)

    const badge = screen.getByTestId('badge')
    expect(badge).toHaveTextContent('Rate Limit')
  })

  it('renders Configuration tab as default active tab', () => {
    render(<PolicyDetailPage />)

    expect(screen.getByTestId('tab-config')).toBeInTheDocument()
    expect(screen.getByTestId('tab-content-config')).toBeInTheDocument()
  })

  it('renders Attached Routes tab', () => {
    render(<PolicyDetailPage />)

    expect(screen.getByTestId('tab-routes')).toBeInTheDocument()
  })

  it('renders Activity tab', () => {
    render(<PolicyDetailPage />)

    expect(screen.getByTestId('tab-activity')).toBeInTheDocument()
  })

  it('shows configuration fields in read mode', () => {
    render(<PolicyDetailPage />)

    // Config data should be visible
    expect(screen.getByText(/requestsPerWindow/i)).toBeInTheDocument()
  })

  it('shows Edit button on Configuration tab', () => {
    render(<PolicyDetailPage />)

    expect(screen.getByText('Edit')).toBeInTheDocument()
  })

  it('renders attached routes for this policy', () => {
    render(<PolicyDetailPage />)

    // rt-1 has pol-1, rt-2 does not
    expect(screen.getByTestId('routes-table')).toBeInTheDocument()
  })

  it('shows delete button in danger zone', () => {
    render(<PolicyDetailPage />)

    expect(screen.getByText('Delete policy')).toBeInTheDocument()
  })

  it('shows confirm dialog when delete clicked', async () => {
    const user = userEvent.setup()
    render(<PolicyDetailPage />)

    await user.click(screen.getByText('Delete policy'))
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
  })
})
