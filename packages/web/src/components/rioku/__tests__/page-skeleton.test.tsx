import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageSkeleton } from '../page-skeleton'

describe('PageSkeleton', () => {
  it('renders stat-cards variant with default 4 cards', () => {
    const { container } = render(<PageSkeleton variant="stat-cards" />)

    expect(screen.getByTestId('skeleton-stat-cards')).toBeInTheDocument()
    // Default 4 cards — each card has a container div with ring-1
    const cards = container.querySelectorAll('[data-testid="skeleton-stat-cards"] > div')
    expect(cards).toHaveLength(4)
  })

  it('renders stat-cards variant with custom card count', () => {
    const { container } = render(<PageSkeleton variant="stat-cards" cards={2} />)

    const cards = container.querySelectorAll('[data-testid="skeleton-stat-cards"] > div')
    expect(cards).toHaveLength(2)
  })

  it('renders table variant with default 5 rows', () => {
    const { container } = render(<PageSkeleton variant="table" />)

    expect(screen.getByTestId('skeleton-table')).toBeInTheDocument()
    // 1 header + 5 row divs = 6 direct children
    const children = container.querySelectorAll('[data-testid="skeleton-table"] > div')
    expect(children).toHaveLength(6)
  })

  it('renders table variant with custom row count', () => {
    const { container } = render(<PageSkeleton variant="table" rows={3} />)

    // 1 header + 3 rows = 4 direct children
    const children = container.querySelectorAll('[data-testid="skeleton-table"] > div')
    expect(children).toHaveLength(4)
  })

  it('renders chart variant', () => {
    render(<PageSkeleton variant="chart" />)

    expect(screen.getByTestId('skeleton-chart')).toBeInTheDocument()
  })

  it('renders detail variant', () => {
    render(<PageSkeleton variant="detail" />)

    expect(screen.getByTestId('skeleton-detail')).toBeInTheDocument()
  })

  it('renders form variant', () => {
    render(<PageSkeleton variant="form" />)

    expect(screen.getByTestId('skeleton-form')).toBeInTheDocument()
  })

  it('passes className to the container', () => {
    render(<PageSkeleton variant="chart" className="my-custom-class" />)

    expect(screen.getByTestId('skeleton-chart')).toHaveClass('my-custom-class')
  })

  it('renders skeleton pulse elements', () => {
    const { container } = render(<PageSkeleton variant="form" />)

    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })
})
