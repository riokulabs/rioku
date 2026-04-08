import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '../empty-state'

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No routes" />)

    expect(screen.getByText('No routes')).toBeInTheDocument()
  })

  it('renders icon when provided', () => {
    render(
      <EmptyState
        title="No data"
        icon={<span data-testid="icon">X</span>}
      />,
    )

    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(
      <EmptyState title="No routes" description="Create your first route" />,
    )

    expect(screen.getByText('Create your first route')).toBeInTheDocument()
  })

  it('renders action when provided', () => {
    render(
      <EmptyState
        title="No routes"
        action={<button>Add Route</button>}
      />,
    )

    expect(screen.getByText('Add Route')).toBeInTheDocument()
  })

  it('does not crash when optional props are missing', () => {
    const { container } = render(<EmptyState title="Empty" />)

    expect(container).toBeTruthy()
    expect(screen.getByText('Empty')).toBeInTheDocument()
  })

  it('does not render icon container when icon is not provided', () => {
    const { container } = render(<EmptyState title="Empty" />)

    expect(container.querySelector('.rounded-full')).not.toBeInTheDocument()
  })
})
