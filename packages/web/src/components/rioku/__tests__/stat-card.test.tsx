import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatCard } from '../stat-card'

describe('StatCard', () => {
  const defaultProps = {
    title: 'Total Routes',
    value: '42',
    icon: <span data-testid="icon">R</span>,
  }

  it('renders title and value', () => {
    render(<StatCard {...defaultProps} />)

    expect(screen.getByText('Total Routes')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders icon', () => {
    render(<StatCard {...defaultProps} />)

    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('renders trend up with green styling and arrow', () => {
    render(
      <StatCard
        {...defaultProps}
        trend={{ value: '+12%', direction: 'up' }}
      />,
    )

    const trendEl = screen.getByText('+12%')
    expect(trendEl).toBeInTheDocument()
    // Parent span should contain green class
    expect(trendEl.closest('span')).toHaveClass('text-green-600')
  })

  it('renders trend down with red styling and arrow', () => {
    render(
      <StatCard
        {...defaultProps}
        trend={{ value: '-5%', direction: 'down' }}
      />,
    )

    const trendEl = screen.getByText('-5%')
    expect(trendEl).toBeInTheDocument()
    expect(trendEl.closest('span')).toHaveClass('text-red-600')
  })

  it('does not render trend element when no trend provided', () => {
    const { container } = render(<StatCard {...defaultProps} />)

    // No arrow icons should be present
    expect(container.querySelector('.text-green-600')).not.toBeInTheDocument()
    expect(container.querySelector('.text-red-600')).not.toBeInTheDocument()
  })

  it('passes className to container', () => {
    const { container } = render(
      <StatCard {...defaultProps} className="custom-class" />,
    )

    // The Card component should receive the className
    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('renders ReactNode values (not just strings)', () => {
    render(
      <StatCard
        title="Status"
        value={<strong data-testid="bold-value">Active</strong>}
        icon={<span>I</span>}
      />,
    )

    expect(screen.getByTestId('bold-value')).toBeInTheDocument()
  })
})
