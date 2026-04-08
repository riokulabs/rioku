import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from '../page-header'

describe('PageHeader', () => {
  it('renders title text', () => {
    render(<PageHeader title="Routes" />)

    expect(
      screen.getByRole('heading', { name: 'Routes' }),
    ).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(
      <PageHeader title="Routes" description="Manage your API routes" />,
    )

    expect(screen.getByText('Manage your API routes')).toBeInTheDocument()
  })

  it('does not render description element when not provided', () => {
    const { container } = render(<PageHeader title="Routes" />)

    // The description is in a <p> tag
    expect(container.querySelector('p')).not.toBeInTheDocument()
  })

  it('renders actions slot', () => {
    render(
      <PageHeader
        title="Routes"
        actions={<button>Create Route</button>}
      />,
    )

    expect(screen.getByText('Create Route')).toBeInTheDocument()
  })

  it('does not render actions container when no actions provided', () => {
    const { container } = render(<PageHeader title="Routes" />)

    // Only the title div should be present, no actions div
    const innerDivs = container.querySelectorAll(':scope > div > div')
    expect(innerDivs).toHaveLength(1) // Just the title space-y-1 div
  })
})
