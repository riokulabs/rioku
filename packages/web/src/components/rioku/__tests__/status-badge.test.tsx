import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '../status-badge'

describe('StatusBadge', () => {
  it('renders "Healthy" with green dot for healthy status', () => {
    render(<StatusBadge status="healthy" />)

    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })

  it('renders "Degraded" for degraded status', () => {
    render(<StatusBadge status="degraded" />)

    expect(screen.getByText('Degraded')).toBeInTheDocument()
  })

  it('renders "Unhealthy" for unhealthy status', () => {
    render(<StatusBadge status="unhealthy" />)

    expect(screen.getByText('Unhealthy')).toBeInTheDocument()
  })

  it('renders "Unknown" for unknown status', () => {
    render(<StatusBadge status="unknown" />)

    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('uses custom label when provided', () => {
    render(<StatusBadge status="healthy" label="All Good" />)

    expect(screen.getByText('All Good')).toBeInTheDocument()
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument()
  })

  it('renders the colored dot element', () => {
    const { container } = render(<StatusBadge status="healthy" />)

    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot).toBeInTheDocument()
    expect(dot).toHaveClass('bg-green-500')
  })

  it('uses yellow dot for degraded status', () => {
    const { container } = render(<StatusBadge status="degraded" />)

    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot).toHaveClass('bg-yellow-500')
  })

  it('uses red dot for unhealthy status', () => {
    const { container } = render(<StatusBadge status="unhealthy" />)

    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot).toHaveClass('bg-red-500')
  })

  it('uses gray dot for unknown status', () => {
    const { container } = render(<StatusBadge status="unknown" />)

    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot).toHaveClass('bg-gray-400')
  })
})
