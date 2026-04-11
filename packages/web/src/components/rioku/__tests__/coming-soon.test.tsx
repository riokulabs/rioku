import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ComingSoon } from '../coming-soon'

describe('ComingSoon', () => {
  it('renders the feature name', () => {
    render(<ComingSoon feature="Certificate Management" />)

    expect(screen.getByText('Certificate Management')).toBeInTheDocument()
  })

  it('renders the description when provided', () => {
    render(
      <ComingSoon
        feature="Plugin Marketplace"
        description="Browse and install plugins from the registry."
      />,
    )

    expect(screen.getByText(/browse and install/i)).toBeInTheDocument()
  })

  it('renders a "Coming Soon" label', () => {
    render(<ComingSoon feature="AI Assistant" />)

    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
  })

  it('renders a GitHub issue link when provided', () => {
    render(
      <ComingSoon
        feature="AI Assistant"
        issueUrl="https://github.com/riokulabs/rioku/issues/42"
      />,
    )

    const link = screen.getByRole('link', { name: /track progress/i })
    expect(link).toHaveAttribute('href', 'https://github.com/riokulabs/rioku/issues/42')
  })

  it('does not render a link when no issueUrl', () => {
    render(<ComingSoon feature="AI Assistant" />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
