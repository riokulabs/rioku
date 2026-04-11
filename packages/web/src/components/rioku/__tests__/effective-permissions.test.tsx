import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/lib/utils', () => ({ cn: (...args: string[]) => args.filter(Boolean).join(' ') }))

vi.mock('@/lib/permissions', () => ({
  computeEffectivePermissions: () => ({
    routes: { view: true, create: false, update: false, delete: false, manage: false },
    services: { view: true, create: false, update: false, delete: false, manage: false },
    policies: { view: false, create: false, update: false, delete: false, manage: false },
    keys: { view: false, create: false, update: false, delete: false, manage: false },
    users: { view: false, create: false, update: false, delete: false, manage: false },
    roles: { view: false, create: false, update: false, delete: false, manage: false },
    settings: { view: false, create: false, update: false, delete: false, manage: false },
    cluster: { view: false, create: false, update: false, delete: false, manage: false },
    plugins: { view: false, create: false, update: false, delete: false, manage: false },
    audit: { view: false, create: false, update: false, delete: false, manage: false },
    traffic: { view: false, create: false, update: false, delete: false, manage: false },
    certificates: { view: false, create: false, update: false, delete: false, manage: false },
    _sources: { routes: { view: 'viewer' } },
  }),
}))

vi.mock('lucide-react', () => ({
  ChevronDownIcon: () => <span data-testid="chevron" />,
  CheckIcon: () => <span data-testid="check-icon">✓</span>,
  XIcon: () => <span data-testid="x-icon">✗</span>,
  MinusIcon: () => <span data-testid="minus-icon">-</span>,
}))

import { EffectivePermissionsPanel } from '../effective-permissions'

describe('EffectivePermissionsPanel', () => {
  const props = {
    assignedRoles: [],
    allRoles: [],
    accessPolicies: [],
  }

  it('renders collapsed by default with summary', () => {
    render(<EffectivePermissionsPanel {...props} />)
    expect(screen.getByText('Effective permissions')).toBeInTheDocument()
    expect(screen.getByText(/2 permissions across 2 resources/)).toBeInTheDocument()
  })

  it('expands when clicked', async () => {
    const user = userEvent.setup()
    render(<EffectivePermissionsPanel {...props} />)
    await user.click(screen.getByText('Effective permissions'))
    expect(screen.getByText('routes')).toBeInTheDocument()
    expect(screen.getByText('services')).toBeInTheDocument()
  })

  it('renders green check for allowed permissions', async () => {
    const user = userEvent.setup()
    render(<EffectivePermissionsPanel {...props} />)
    await user.click(screen.getByText('Effective permissions'))
    const checks = screen.getAllByTestId('check-icon')
    expect(checks.length).toBe(2) // routes.view and services.view
  })

  it('uses aria-expanded', () => {
    render(<EffectivePermissionsPanel {...props} />)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })
})
