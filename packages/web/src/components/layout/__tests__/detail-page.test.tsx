import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ---------------------------------------------------------------------------
// Mock TanStack Router (Link only — no navigate/search needed)
// ---------------------------------------------------------------------------
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

import { DetailPage, type DetailTab } from '../detail-page'

function renderDetailPage(
  props: Partial<React.ComponentProps<typeof DetailPage>> = {},
) {
  const defaultProps = {
    title: 'Route Details',
    backLabel: 'Back to Routes',
    backTo: '/config/routes',
  }
  return render(<DetailPage {...defaultProps} {...props} />)
}

describe('DetailPage', () => {
  const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset URL search params between tests
    window.history.replaceState(null, '', window.location.pathname)
    replaceStateSpy.mockClear()
  })

  it('renders page title in h1', () => {
    renderDetailPage()

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('Route Details')
  })

  it('renders back button with correct label', () => {
    renderDetailPage()

    const link = screen.getByRole('link', { name: /back to routes/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/config/routes')
  })

  it('renders subtitle when provided', () => {
    renderDetailPage({ subtitle: '/api/v1/users' })

    expect(screen.getByText('/api/v1/users')).toBeInTheDocument()
  })

  it('renders tabs when tabs prop is provided', () => {
    const tabs: DetailTab[] = [
      { id: 'overview', label: 'Overview', content: <div>Overview content</div> },
      { id: 'config', label: 'Configuration', content: <div>Config content</div> },
      { id: 'logs', label: 'Logs', content: <div>Logs content</div> },
    ]

    renderDetailPage({ tabs })

    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Configuration' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Logs' })).toBeInTheDocument()
  })

  it('active tab determined from URL param', () => {
    // Set ?tab=config in the URL before rendering
    window.history.replaceState(null, '', '?tab=config')
    replaceStateSpy.mockClear()

    const tabs: DetailTab[] = [
      { id: 'overview', label: 'Overview', content: <div>Overview content</div> },
      { id: 'config', label: 'Configuration', content: <div>Config content</div> },
    ]

    renderDetailPage({ tabs })

    const configTab = screen.getByRole('tab', { name: 'Configuration' })
    expect(configTab).toHaveAttribute('aria-selected', 'true')
  })

  it('defaults to first tab when no URL param', () => {
    const tabs: DetailTab[] = [
      { id: 'overview', label: 'Overview', content: <div>Overview content</div> },
      { id: 'config', label: 'Configuration', content: <div>Config content</div> },
    ]

    renderDetailPage({ tabs })

    const overviewTab = screen.getByRole('tab', { name: 'Overview' })
    expect(overviewTab).toHaveAttribute('aria-selected', 'true')
  })

  it('defaults to specified defaultTab when no URL param', () => {
    const tabs: DetailTab[] = [
      { id: 'overview', label: 'Overview', content: <div>Overview content</div> },
      { id: 'config', label: 'Configuration', content: <div>Config content</div> },
    ]

    renderDetailPage({ tabs, defaultTab: 'config' })

    const configTab = screen.getByRole('tab', { name: 'Configuration' })
    expect(configTab).toHaveAttribute('aria-selected', 'true')
  })

  it('updates URL when tab is clicked', async () => {
    const user = userEvent.setup()
    const tabs: DetailTab[] = [
      { id: 'overview', label: 'Overview', content: <div>Overview content</div> },
      { id: 'config', label: 'Configuration', content: <div>Config content</div> },
    ]

    renderDetailPage({ tabs })

    await user.click(screen.getByRole('tab', { name: 'Configuration' }))

    // Should have called replaceState with a URL containing tab=config
    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      '',
      expect.stringContaining('tab=config'),
    )
  })

  it('renders toolbar content', () => {
    renderDetailPage({
      toolbar: <button type="button">Edit</button>,
    })

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('renders children content', () => {
    renderDetailPage({
      children: <p>Main content area</p>,
    })

    expect(screen.getByText('Main content area')).toBeInTheDocument()
  })

  it('renders metadata sidebar when provided', () => {
    renderDetailPage({
      metadata: <div>Created: 2026-01-01</div>,
      children: <p>Content</p>,
    })

    expect(screen.getByText('Created: 2026-01-01')).toBeInTheDocument()
  })

  it('renders tab content for the active tab', () => {
    const tabs: DetailTab[] = [
      { id: 'overview', label: 'Overview', content: <div>Overview content</div> },
      { id: 'config', label: 'Configuration', content: <div>Config content</div> },
    ]

    renderDetailPage({ tabs })

    // Default active tab is first one — its content should be visible
    expect(screen.getByText('Overview content')).toBeInTheDocument()
  })
})
