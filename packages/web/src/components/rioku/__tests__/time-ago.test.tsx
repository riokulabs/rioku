import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TimeAgo } from '../time-ago'
import { TooltipProvider } from '@/components/ui/tooltip'

// Wrap with TooltipProvider since TimeAgo uses Tooltip
function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('TimeAgo', () => {
  it('renders a relative time string', () => {
    // Use a date from 5 minutes ago
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
    renderWithTooltip(<TimeAgo date={fiveMinAgo} />)

    // formatDistanceToNow returns something like "5 minutes ago"
    expect(screen.getByText(/minutes? ago/i)).toBeInTheDocument()
  })

  it('handles string date input', () => {
    const dateStr = new Date(Date.now() - 3600 * 1000).toISOString()
    renderWithTooltip(<TimeAgo date={dateStr} />)

    expect(screen.getByText(/hour/i)).toBeInTheDocument()
  })

  it('handles Date object input', () => {
    const date = new Date(Date.now() - 2 * 3600 * 1000)
    renderWithTooltip(<TimeAgo date={date} />)

    expect(screen.getByText(/hours? ago/i)).toBeInTheDocument()
  })

  it('renders without crashing for recent dates', () => {
    renderWithTooltip(<TimeAgo date={new Date()} />)

    // "less than a minute ago" or similar
    expect(screen.getByText(/less than|seconds?/i)).toBeInTheDocument()
  })
})
