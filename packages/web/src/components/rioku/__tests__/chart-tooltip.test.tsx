import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChartTooltip } from '../chart-tooltip'

describe('ChartTooltip', () => {
  it('renders nothing when not active', () => {
    const { container } = render(
      <ChartTooltip active={false} payload={[]} label="" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders label and payload values', () => {
    render(
      <ChartTooltip
        active
        label="12:00"
        payload={[
          { name: 'errors', value: 42, color: '#ef4444' },
          { name: 'requests', value: 1200, color: '#3b82f6' },
        ]}
      />,
    )

    expect(screen.getByText('12:00')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('1,200')).toBeInTheDocument()
  })

  it('renders colored dots for each series', () => {
    const { container } = render(
      <ChartTooltip
        active
        label="12:00"
        payload={[
          { name: 'p50', value: 10, color: '#3b82f6' },
          { name: 'p99', value: 80, color: '#ef4444' },
        ]}
      />,
    )

    const dots = container.querySelectorAll('[data-testid="tooltip-dot"]')
    expect(dots).toHaveLength(2)
  })

  it('bolds the series with the highest value', () => {
    render(
      <ChartTooltip
        active
        label="12:00"
        payload={[
          { name: 'low', value: 10, color: '#3b82f6' },
          { name: 'high', value: 999, color: '#ef4444' },
        ]}
      />,
    )

    // The highest value row should be bold
    const highRow = screen.getByText('999').closest('[data-testid="tooltip-row"]')
    expect(highRow).toHaveClass('font-semibold')
  })
})
