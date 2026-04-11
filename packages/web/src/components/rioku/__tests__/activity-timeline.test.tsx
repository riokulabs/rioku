import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityTimeline } from '@/components/rioku/activity-timeline'

const entries = [
  { action: 'Route created', user: 'admin@rioku.io', timestamp: '2026-04-09 16:22 UTC', detail: 'Initial creation' },
  { action: 'Configuration updated', user: 'jdoe@company.com', timestamp: '2026-04-08 11:05 UTC', detail: 'Changed LB policy' },
]

describe('ActivityTimeline', () => {
  it('renders all entries', () => {
    render(<ActivityTimeline entries={entries} />)
    expect(screen.getByText('Route created')).toBeInTheDocument()
    expect(screen.getByText('Configuration updated')).toBeInTheDocument()
  })

  it('shows user and detail for each entry', () => {
    render(<ActivityTimeline entries={entries} />)
    expect(screen.getByText(/admin@rioku\.io/)).toBeInTheDocument()
    expect(screen.getByText('Initial creation')).toBeInTheDocument()
  })

  it('renders empty state when no entries', () => {
    render(<ActivityTimeline entries={[]} />)
    expect(screen.getByText(/no activity/i)).toBeInTheDocument()
  })

  it('applies color coding based on action type', () => {
    const { container } = render(<ActivityTimeline entries={entries} />)
    // 'created' should have a green dot
    const dots = container.querySelectorAll('[data-activity-dot]')
    expect(dots.length).toBe(2)
  })

  it('renders custom title when provided', () => {
    render(<ActivityTimeline entries={entries} title="Audit Log" />)
    expect(screen.getByText('Audit Log')).toBeInTheDocument()
  })

  it('renders default title when none provided', () => {
    render(<ActivityTimeline entries={entries} />)
    expect(screen.getByText('Recent Changes')).toBeInTheDocument()
  })

  it('applies green dot for created actions', () => {
    const { container } = render(
      <ActivityTimeline entries={[{ action: 'Route created', user: 'admin', timestamp: 'now', detail: 'test' }]} />,
    )
    const dot = container.querySelector('[data-activity-dot]')
    expect(dot).toHaveClass('bg-green-500')
  })

  it('applies blue dot for updated actions', () => {
    const { container } = render(
      <ActivityTimeline entries={[{ action: 'Configuration updated', user: 'admin', timestamp: 'now', detail: 'test' }]} />,
    )
    const dot = container.querySelector('[data-activity-dot]')
    expect(dot).toHaveClass('bg-blue-500')
  })

  it('applies red dot for deleted actions', () => {
    const { container } = render(
      <ActivityTimeline entries={[{ action: 'Route deleted', user: 'admin', timestamp: 'now', detail: 'test' }]} />,
    )
    const dot = container.querySelector('[data-activity-dot]')
    expect(dot).toHaveClass('bg-red-500')
  })

  it('applies amber dot for enabled/disabled actions', () => {
    const { container } = render(
      <ActivityTimeline entries={[{ action: 'Route disabled', user: 'admin', timestamp: 'now', detail: 'test' }]} />,
    )
    const dot = container.querySelector('[data-activity-dot]')
    expect(dot).toHaveClass('bg-amber-500')
  })

  it('applies purple dot for attached/detached actions', () => {
    const { container } = render(
      <ActivityTimeline entries={[{ action: 'Middleware attached', user: 'admin', timestamp: 'now', detail: 'test' }]} />,
    )
    const dot = container.querySelector('[data-activity-dot]')
    expect(dot).toHaveClass('bg-purple-500')
  })
})
