import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to} data-testid="router-link">{children}</a>
  ),
  useNavigate: () => mockNavigate,
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const t: Record<string, string> = {
        'create.title': 'Create policy',
        'create.backToList': 'Back to policies',
        'create.selectType': 'Select policy type',
        'create.selectTypeDesc': 'Choose the type of policy you want to create.',
        'create.policyName': 'Policy name',
        'create.policyNamePlaceholder': 'rate-limit-global',
        'create.configuration': 'Configuration',
        'create.save': 'Create policy',
        'create.cancel': 'Cancel',
        'messages.policyCreated': 'Policy created',
      }
      return t[key] ?? key
    },
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({ apiClient: { post: vi.fn() } }))

vi.mock('@/lib/schemas/policy-schemas', () => ({
  policySchemaFor: () => ({
    safeParse: () => ({ success: true, data: {} }),
  }),
}))

vi.mock('lucide-react', () => ({
  ArrowLeftIcon: () => <span />,
  GaugeIcon: () => <span>G</span>,
  ShieldCheckIcon: () => <span>S</span>,
  KeyIcon: () => <span>K</span>,
  GlobeIcon: () => <span>GL</span>,
  ZapOffIcon: () => <span>Z</span>,
  ArrowUpDownIcon: () => <span>A</span>,
  DatabaseIcon: () => <span>D</span>,
  RefreshCwIcon: () => <span>R</span>,
}))

vi.mock('@/components/rioku/type-selector-tiles', () => ({
  TypeSelectorTiles: ({ options, value, onChange }: {
    options: Array<{ value: string; label: string }>
    value: string | null
    onChange: (v: string) => void
  }) => (
    <div data-testid="type-tiles">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          data-testid={`tile-${opt.value}`}
          data-selected={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/components/rioku/policy-forms', () => ({
  PolicyFormForType: ({ type }: { type: string }) => (
    <div data-testid="policy-form">Form for {type}</div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, render, ...props }: React.ComponentProps<'button'> & { render?: React.ReactElement }) => {
    if (render) {
      const rp = (render as { props: Record<string, unknown> }).props ?? {}
      return <a href={rp.to as string} data-testid="button-link">{children}</a>
    }
    return <button onClick={onClick} disabled={disabled} {...props}>{children}</button>
  },
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.ComponentProps<'label'>) => <label {...props}>{children}</label>,
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}))

import { PolicyCreatePage } from '../policies.create'

describe('PolicyCreatePage', () => {
  it('renders page title', () => {
    render(<PolicyCreatePage />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create policy')
  })

  it('renders back link to policies list', () => {
    render(<PolicyCreatePage />)
    const links = screen.getAllByTestId('router-link')
    expect(links.some((l) => l.getAttribute('href') === '/config/policies')).toBe(true)
  })

  it('renders name input', () => {
    render(<PolicyCreatePage />)
    expect(screen.getByLabelText('Policy name')).toBeInTheDocument()
  })

  it('renders type selector tiles with all 8 types', () => {
    render(<PolicyCreatePage />)
    expect(screen.getByTestId('type-tiles')).toBeInTheDocument()
    expect(screen.getByText('Rate Limit')).toBeInTheDocument()
    expect(screen.getByText('Auth (JWT)')).toBeInTheDocument()
    expect(screen.getByText('CORS')).toBeInTheDocument()
    expect(screen.getByText('Circuit Breaker')).toBeInTheDocument()
    expect(screen.getByText('Cache')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
    expect(screen.getByText('Transform')).toBeInTheDocument()
  })

  it('does not show form until type selected', () => {
    render(<PolicyCreatePage />)
    expect(screen.queryByTestId('policy-form')).not.toBeInTheDocument()
  })

  it('shows form when type is selected', async () => {
    const user = userEvent.setup()
    render(<PolicyCreatePage />)
    await user.click(screen.getByTestId('tile-POLICY_TYPE_RATE_LIMIT'))
    expect(screen.getByTestId('policy-form')).toBeInTheDocument()
    expect(screen.getByText('Form for POLICY_TYPE_RATE_LIMIT')).toBeInTheDocument()
  })

  it('disables save button when name is empty', () => {
    render(<PolicyCreatePage />)
    const saveButton = screen.getByText('Create policy', { selector: 'button' })
    expect(saveButton).toBeDisabled()
  })

  it('renders cancel link', () => {
    render(<PolicyCreatePage />)
    const cancelLink = screen.getAllByTestId('button-link').find((l) => l.textContent === 'Cancel')
    expect(cancelLink).toBeDefined()
  })
})
