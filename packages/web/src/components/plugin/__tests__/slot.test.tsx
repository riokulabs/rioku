import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Slot } from '../slot'
import { pluginRegistry, type ZoneProps } from '@/lib/plugin-registry'

describe('Slot', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('renders nothing when no injections for zone', () => {
    const { container } = render(<Slot zone="nonexistent" />)

    expect(container.innerHTML).toBe('')
  })

  it('renders a single injection component', () => {
    const TestComponent = ({ zone, pluginId }: ZoneProps) => (
      <div data-testid="injected">
        {zone} - {pluginId}
      </div>
    )

    pluginRegistry.register({
      id: 'test-plugin',
      name: 'Test',
      version: '1.0.0',
      injections: [
        { zone: 'sidebar.bottom', component: TestComponent },
      ],
    })

    render(<Slot zone="sidebar.bottom" />)

    expect(screen.getByTestId('injected')).toBeInTheDocument()
    expect(screen.getByText(/sidebar\.bottom/)).toBeInTheDocument()
  })

  it('renders multiple injections sorted by priority', () => {
    const ComponentA = ({ pluginId }: ZoneProps) => (
      <div data-testid="comp-a">{pluginId}</div>
    )
    const ComponentB = ({ pluginId }: ZoneProps) => (
      <div data-testid="comp-b">{pluginId}</div>
    )

    pluginRegistry.register({
      id: 'plugin-a',
      name: 'A',
      version: '1.0.0',
      injections: [
        { zone: 'header.actions', component: ComponentA, priority: 10 },
      ],
    })
    pluginRegistry.register({
      id: 'plugin-b',
      name: 'B',
      version: '1.0.0',
      injections: [
        { zone: 'header.actions', component: ComponentB, priority: 1 },
      ],
    })

    const { container } = render(<Slot zone="header.actions" />)

    const divs = container.querySelectorAll('[data-testid]')
    // Priority 1 (plugin-b) should render before priority 10 (plugin-a)
    expect(divs[0]).toHaveAttribute('data-testid', 'comp-b')
    expect(divs[1]).toHaveAttribute('data-testid', 'comp-a')
  })
})
